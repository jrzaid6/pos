import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import api from '../services/api'
import { Link } from 'react-router-dom'

const formatCurrency = (value) => `₹${Number(value || 0).toFixed(2)}`
const monthValue = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function BankCash({ user }) {
  const [tab, setTab] = useState('purchase')
  const [dashboard, setDashboard] = useState(null)
  const [products, setProducts] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ product_id: '', source: 'bank', quantity: '', purchase_price: '', note: '' })
  const [periodMonth, setPeriodMonth] = useState(monthValue())
  const [year, setYear] = useState(String(new Date().getFullYear()))

  const canManage = user?.role === 'admin' || user?.role === 'manager'

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoading(true)
      const [dashboardRes, productsRes] = await Promise.all([
        api.get(`/bank-cash/dashboard?period=monthly&month=${periodMonth.split('-')[1]}&year=${periodMonth.split('-')[0]}`),
        api.get('/products')
      ])
      setDashboard(dashboardRes.data)
      setProducts(productsRes.data)
    } catch (error) {
      console.error('Bank cash load error', error)
    } finally {
      setLoading(false)
    }
  }

  const loadMonthly = async () => {
    const [selectedYear, selectedMonth] = periodMonth.split('-')
    const res = await api.get(`/bank-cash/dashboard?period=monthly&month=${selectedMonth}&year=${selectedYear}`)
    setDashboard(res.data)
  }

  const loadYearly = async () => {
    const res = await api.get(`/bank-cash/dashboard?period=yearly&year=${year}`)
    setDashboard(res.data)
  }

  const exportPdf = async (section) => {
    const { data } = await api.get(`/bank-cash/export?section=${section}`)
    const doc = new jsPDF()
    let y = 16
    doc.setFontSize(16)
    doc.text(`${section === 'bank' ? 'Bank' : 'Cash'} Export`, 14, y)
    y += 8
    doc.setFontSize(10)
    doc.text(`Generated ${new Date().toLocaleString()}`, 14, y)
    y += 8
    doc.text('Book', 14, y)
    y += 6
    data.book.slice(0, 25).forEach((row) => {
      if (y > 280) {
        doc.addPage()
        y = 16
      }
      doc.text(`${new Date(row.created_at).toLocaleDateString()}  ${row.transaction_type}  ${row.reference || ''}  ${row.amount}`, 14, y)
      y += 5
    })
    y += 4
    doc.text('Sales', 14, y)
    y += 6
    data.sales.slice(0, 25).forEach((row) => {
      if (y > 280) {
        doc.addPage()
        y = 16
      }
      doc.text(`${row.bill_number}  ${row.product_name}  Qty ${row.quantity}  ${row.total}`, 14, y)
      y += 5
    })
    doc.save(`${section}-export-${new Date().toISOString().split('T')[0]}.pdf`)
  }

  const exportExcel = async () => {
    const { data } = await api.get('/bank-cash/export?section=bank')
    const rows = [
      ['Type', 'Date', 'Reference', 'Payment', 'Amount', 'Note'],
      ...data.book.map((row) => [row.transaction_type, new Date(row.created_at).toLocaleString(), row.reference || '', row.payment_method || '', row.amount, row.note || ''])
    ]
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `bank-export-${new Date().toISOString().split('T')[0]}.csv`
    link.click()
    window.URL.revokeObjectURL(url)
  }

  const summaryCards = useMemo(() => {
    if (!dashboard) return []
    return [
      { label: 'Bank Sales', value: formatCurrency(dashboard.summary.bank_sales) },
      { label: 'Cash Sales', value: formatCurrency(dashboard.summary.cash_sales) },
      { label: 'Bank Profit', value: formatCurrency(dashboard.summary.bank_profit) },
      { label: 'Cash Profit', value: formatCurrency(dashboard.summary.cash_profit) }
    ]
  }, [dashboard])

  if (loading && !dashboard) return <div className="loading">Loading...</div>

  return (
    <div className="bank-cash-page">
      <div className="page-header">
        <div>
          <h1>Bank/Cash</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.35rem' }}>Source-based stock reporting, books, purchase entries and exports.</p>
        </div>
      </div>

      <div className="stats-grid">
        {summaryCards.map((card) => (
          <div key={card.label} className="stat-card">
            <h3>{card.label}</h3>
            <div className="value" style={{ fontSize: '1.6rem' }}>{card.value}</div>
          </div>
        ))}
      </div>

      <div className="bank-cash-tabs">
        {[
          ['purchase', 'Purchase Entry'],
          ['cashBook', 'Cash Book'],
          ['bankBook', 'Bank Book'],
          ['monthly', 'Monthly'],
          ['yearly', 'Yearly'],
          ['profit', 'Profit/Loss'],
          ['export', 'Export']
        ].map(([key, label]) => (
          <button key={key} className={`category-pill ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      <div className="bank-cash-panel">
        {tab === 'purchase' && (
          <div className="bank-cash-grid">
            <section className="data-table bank-cash-card" style={{ padding: '1.5rem' }}>
              <h3>Purchase invoices</h3>
              <p style={{ margin: '1rem 0', color: 'var(--text-secondary)', lineHeight: 1.6 }}>Record purchases in the Vendor workspace to keep invoices, stock and supplier balances connected. Cash and bank books show actual payments.</p>
              <Link className="btn btn-primary" to="/vendors">Open Vendor workspace</Link>
            </section>

            <div className="data-table bank-cash-card">
              <div className="bank-cash-table-scroll">
                <table>
                  <thead><tr><th>Date</th><th>Product</th><th>Source</th><th>Qty</th><th>Price</th></tr></thead>
                  <tbody>
                    {dashboard?.purchaseEntries?.map((entry) => (
                      <tr key={entry.id}>
                        <td>{new Date(entry.created_at).toLocaleDateString()}</td>
                        <td>{entry.product_name}</td>
                        <td>{entry.source}</td>
                        <td>{entry.quantity}</td>
                        <td>{formatCurrency(entry.purchase_price)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === 'cashBook' && <BookTable title="Cash Book" rows={dashboard?.cashBook || []} />}
        {tab === 'bankBook' && <BookTable title="Bank Book" rows={dashboard?.bankBook || []} />}

        {tab === 'monthly' && (
          <div className="data-table bank-cash-card" style={{ padding: '1rem' }}>
            <div className="bank-cash-actions">
              <input type="month" value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} />
              <button className="btn btn-secondary" style={{ width: 'auto' }} onClick={loadMonthly}>Load Monthly</button>
            </div>
            <SimpleTable rows={dashboard?.monthly || []} columns={['label', 'bank_sales', 'cash_sales', 'total_sales']} />
          </div>
        )}

        {tab === 'yearly' && (
          <div className="data-table bank-cash-card" style={{ padding: '1rem' }}>
            <div className="bank-cash-actions">
              <input value={year} onChange={(e) => setYear(e.target.value)} />
              <button className="btn btn-secondary" style={{ width: 'auto' }} onClick={loadYearly}>Load Yearly</button>
            </div>
            <SimpleTable rows={dashboard?.yearly || []} columns={['label', 'bank_sales', 'cash_sales', 'total_sales']} />
          </div>
        )}

        {tab === 'profit' && (
          <div className="data-table bank-cash-card" style={{ padding: '1rem' }}>
            <SimpleTable
              rows={[
                { section: 'Bank', amount: formatCurrency(dashboard?.profitLoss?.bank) },
                { section: 'Cash', amount: formatCurrency(dashboard?.profitLoss?.cash) },
                { section: 'Total', amount: formatCurrency(dashboard?.profitLoss?.total) }
              ]}
              columns={['section', 'amount']}
            />
          </div>
        )}

        {tab === 'export' && (
          <div className="data-table bank-cash-card" style={{ padding: '1rem' }}>
            <div className="bank-cash-actions">
              <button className="btn btn-secondary" style={{ width: 'auto' }} onClick={() => exportPdf('bank')}>Bank PDF</button>
              <button className="btn btn-secondary" style={{ width: 'auto' }} onClick={exportExcel}>Bank Excel</button>
              <button className="btn btn-warning" style={{ width: 'auto' }} onClick={() => exportPdf('cash')}>Cash PDF</button>
            </div>
            <p style={{ color: 'var(--text-secondary)', marginTop: '1rem' }}>Bank export downloads PDF and Excel-compatible CSV. Cash export downloads PDF.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function BookTable({ title, rows }) {
  return (
    <div className="data-table bank-cash-card">
      <div style={{ padding: '1rem', borderBottom: '1px solid var(--border)', fontWeight: 700 }}>{title}</div>
      <div className="bank-cash-table-scroll">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Payment</th><th>Amount</th><th>Note</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString()}</td>
                <td>{row.transaction_type}</td>
                <td>{row.reference || '-'}</td>
                <td>{row.payment_method || '-'}</td>
                <td>{formatCurrency(row.amount)}</td>
                <td>{row.note || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SimpleTable({ rows, columns }) {
  return (
    <div className="bank-cash-table-scroll" style={{ marginTop: '1rem' }}>
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>{columns.map((column) => <td key={column}>{row[column]}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default BankCash
