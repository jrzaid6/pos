import { useEffect, useState } from 'react'
import { jsPDF } from 'jspdf'
import api from '../services/api'
import InfoModal from '../components/InfoModal'

const REPORT_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'sales', label: 'Sales' },
  { id: 'products', label: 'Products' },
  { id: 'credit', label: 'Credit' }
]

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const formatDate = (value, options = { day: '2-digit', month: 'short', year: 'numeric' }) => {
  const datePart = String(value || '').slice(0, 10)
  const date = new Date(`${datePart}T12:00:00`)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-IN', options)
}

function Reports({ user }) {
  const [tab, setTab] = useState('overview')
  const [period, setPeriod] = useState('month')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('all')
  const [customerId, setCustomerId] = useState('')
  const [cashierId, setCashierId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [search, setSearch] = useState('')
  const [customers, setCustomers] = useState([])
  const [categories, setCategories] = useState([])
  const [staffOptions, setStaffOptions] = useState([])
  const [analytics, setAnalytics] = useState(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [infoModal, setInfoModal] = useState({ isOpen: false, title: '', message: '' })

  const loadBaseData = async () => {
    try {
      const [customersResponse, categoriesResponse] = await Promise.all([
        api.get('/customers'),
        api.get('/products/categories')
      ])
      setCustomers(customersResponse.data)
      setCategories(categoriesResponse.data)
    } catch {
      setError('Could not load report filters. Refresh and try again.')
    }
  }

  const loadReports = async (requestedPage = page) => {
    if (period === 'custom' && (!fromDate || !toDate)) {
      setError('Choose both dates to view a custom report.')
      return
    }
    if (period === 'custom' && fromDate > toDate) {
      setError('The start date must be before the end date.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ period, payment_method: paymentMethod, page: String(requestedPage), pageSize: '25' })
      if (period === 'custom') { params.set('from', fromDate); params.set('to', toDate) }
      if (customerId) params.set('customer_id', customerId)
      if (cashierId) params.set('cashier_id', cashierId)
      if (categoryId) params.set('category_id', categoryId)
      if (search.trim()) params.set('q', search.trim())
      const response = await api.get(`/sales/analytics?${params.toString()}`)
      setAnalytics(response.data)
      setStaffOptions((existing) => {
        const options = new Map(existing.map((item) => [String(item.user_id), item]))
        response.data.cashierBreakdown.forEach((item) => options.set(String(item.user_id), item))
        return [...options.values()]
      })
      setPage(requestedPage)
    } catch (requestError) {
      setAnalytics(null)
      setError(requestError.response?.data?.error || 'Reports could not be loaded. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadBaseData() }, [])
  useEffect(() => { if (period !== 'custom') loadReports(1) }, [period])

  const exportCurrentPageCsv = () => {
    if (!analytics) return
    const rows = [
      ['Bill number', 'Date', 'Customer', 'Cashier', 'Payment type', 'Net sales', 'Paid', 'Due'],
      ...analytics.recentSales.map((sale) => [
        sale.bill_number,
        formatDate(sale.created_at),
        sale.customer_name,
        sale.cashier_name,
        sale.payment_method,
        Number(sale.total_amount || 0).toFixed(2),
        Number(sale.amount_paid || 0).toFixed(2),
        Number(sale.balance_due || 0).toFixed(2)
      ])
    ]
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `sales-page-${page}-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const downloadSummaryPdf = () => {
    if (!analytics) return
    const doc = new jsPDF()
    const pageWidth = doc.internal.pageSize.getWidth()
    let y = 20
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    doc.text('Shop Reports', 18, y)
    y += 8
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(`Period: ${period}${period === 'custom' ? ` (${fromDate} to ${toDate})` : ''}`, 18, y)
    doc.text(`Generated: ${new Date().toLocaleString('en-IN')}`, pageWidth - 18, y, { align: 'right' })
    y += 10
    doc.line(18, y, pageWidth - 18, y)
    y += 9
    const metrics = [
      ['Net sales', money(summary.total_sales)],
      ['Bills', String(summary.total_bills || 0)],
      ['Average bill', money(summary.avg_bill_value)],
      ['Discount given', money(summary.total_discount)],
      ['Current outstanding', money(due.total_due)]
    ]
    metrics.forEach(([label, value]) => { doc.setFont('helvetica', 'bold'); doc.text(label, 18, y); doc.setFont('helvetica', 'normal'); doc.text(value, pageWidth - 18, y, { align: 'right' }); y += 7 })
    y += 3
    doc.setFont('helvetica', 'bold')
    doc.text('Payment split', 18, y)
    y += 7
    doc.setFont('helvetica', 'normal')
    paymentRows.forEach((item) => { doc.text(`${item.payment_method.toUpperCase()} · ${item.bills} bills`, 18, y); doc.text(money(item.amount), pageWidth - 18, y, { align: 'right' }); y += 6 })
    doc.save(`shop-reports-${period}-${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  const downloadBillPdf = async (saleId) => {
    try {
      const response = await api.get(`/sales/${saleId}`)
      const sale = response.data
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [80, 220] })
      let y = 9
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      doc.text(sale.bill_number || 'Sale receipt', 40, y, { align: 'center' })
      y += 7
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.text(formatDate(sale.created_at), 5, y)
      y += 5
      doc.text(`Customer: ${String(sale.customer_name || 'Walk-in').slice(0, 32)}`, 5, y)
      y += 5
      doc.text(`Cashier: ${String(sale.cashier_name || '—').slice(0, 32)}`, 5, y)
      y += 4
      doc.line(5, y, 75, y)
      y += 5
      ;(sale.items || []).forEach((item) => {
        if (y > 195) { doc.addPage([80, 220]); y = 10 }
        doc.text(String(item.product_name || 'Item').slice(0, 20), 5, y)
        doc.text(`${item.quantity} × ₹${Number(item.price || 0).toFixed(2)}`, 5, y + 4)
        doc.text(`₹${Number(item.total || 0).toFixed(2)}`, 75, y + 4, { align: 'right' })
        y += 9
      })
      y += 2
      doc.line(5, y, 75, y)
      y += 6
      doc.text(`Discount: ₹${Number(sale.discount || 0).toFixed(2)}`, 5, y)
      y += 5
      doc.setFont('helvetica', 'bold')
      doc.text(`Total: ₹${Number(sale.total_amount || 0).toFixed(2)}`, 5, y)
      y += 5
      doc.setFont('helvetica', 'normal')
      doc.text(`Paid: ₹${Number(sale.amount_paid || 0).toFixed(2)}`, 5, y)
      y += 5
      doc.text(`Due: ₹${Number(sale.balance_due || 0).toFixed(2)}`, 5, y)
      doc.save(`${sale.bill_number || 'sale'}.pdf`)
    } catch (requestError) {
      setInfoModal({ isOpen: true, title: 'Could not open bill', message: requestError.response?.data?.error || 'Please try again.' })
    }
  }

  const summary = analytics?.summary || {}
  const paymentRows = (analytics?.paymentBreakdown || []).filter((item) => Number(item.amount || 0) > 0 || Number(item.bills || 0) > 0)
  const maximumPayment = Math.max(...paymentRows.map((item) => Number(item.amount || 0)), 1)
  const dailyRows = [...(analytics?.timeline || [])].reverse()
  const maximumDay = Math.max(...dailyRows.map((item) => Number(item.sales || 0)), 1)
  const pagination = analytics?.salesPagination || { page: 1, pageSize: 25, total: 0, totalPages: 1 }
  const due = analytics?.creditAging || { total_due: 0, bucket_0_7: 0, bucket_8_30: 0, bucket_30_plus: 0 }
  const comparison = analytics?.comparison
  const comparisonRate = comparison && Number(comparison.total_sales) > 0
    ? ((Number(summary.total_sales || 0) - Number(comparison.total_sales)) / Number(comparison.total_sales)) * 100
    : null

  return (
    <main className="reports-page">
      <header className="reports-header">
        <div>
          <span className="reports-eyebrow">SHOP PERFORMANCE</span>
          <h1>Reports</h1>
          <p>Clear numbers for sales, products and udhaar.</p>
        </div>
        <div className="reports-header-actions">
          <button className="btn btn-secondary" onClick={() => loadReports(page)} disabled={loading}>Refresh</button>
          {tab === 'overview' && <button className="btn btn-warning" onClick={downloadSummaryPdf} disabled={!analytics}>Summary PDF</button>}
          {tab === 'sales' && <button className="btn btn-primary" onClick={exportCurrentPageCsv} disabled={!analytics?.recentSales?.length}>Export this page</button>}
        </div>
      </header>

      <section className="reports-filter-panel" aria-label="Report filters">
        <label className="reports-filter-field"><span>Date range</span><select value={period} onChange={(event) => setPeriod(event.target.value)}>
          <option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="year">This year</option><option value="financial-year">Financial year</option><option value="all">All time</option><option value="custom">Custom dates</option>
        </select></label>
        {period === 'custom' && <>
          <label className="reports-filter-field"><span>From</span><input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} /></label>
          <label className="reports-filter-field"><span>To</span><input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} /></label>
        </>}
        <label className="reports-filter-field"><span>Payment</span><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}><option value="all">All payments</option><option value="cash">Cash bills</option><option value="upi">UPI bills</option><option value="udhar">Credit bills</option><option value="split">Split bills</option></select></label>
        <label className="reports-filter-field"><span>Customer</span><select value={customerId} onChange={(event) => setCustomerId(event.target.value)}><option value="">All customers</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
        <label className="reports-filter-field"><span>Cashier</span><select value={cashierId} onChange={(event) => setCashierId(event.target.value)}><option value="">All staff</option>{staffOptions.map((cashier) => <option key={cashier.user_id || cashier.cashier_name} value={cashier.user_id}>{cashier.cashier_name}</option>)}</select></label>
        <label className="reports-filter-field"><span>Category</span><select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">All categories</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
        <label className="reports-filter-field reports-search-field"><span>Find a bill</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Bill number, customer or cashier" /></label>
        <button className="btn btn-primary reports-apply-button" onClick={() => loadReports(1)} disabled={loading}>{loading ? 'Loading…' : 'Apply filters'}</button>
      </section>

      <nav className="reports-tabs" aria-label="Report sections" role="tablist">
        {REPORT_TABS.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}
      </nav>

      {error && <div className="reports-error" role="alert">{error}</div>}
      {loading && !analytics && <div className="loading">Loading reports…</div>}
      {!loading && analytics && <>
        {tab === 'overview' && <>
          <section className="reports-kpi-grid">
            <article className="reports-kpi reports-kpi-primary"><span>Net sales</span><strong>{money(summary.total_sales)}</strong><small>After bill discounts{comparison ? ` · ${comparisonRate === null ? 'No previous sales' : `${comparisonRate >= 0 ? '+' : ''}${comparisonRate.toFixed(1)}% vs prior period`}` : ''}</small></article>
            <article className="reports-kpi"><span>Bills</span><strong>{Number(summary.total_bills || 0).toLocaleString('en-IN')}</strong><small>{comparison ? `${Number(summary.total_bills || 0) - Number(comparison.total_bills || 0) >= 0 ? '+' : ''}${Number(summary.total_bills || 0) - Number(comparison.total_bills || 0)} vs previous period` : 'Deleted bills excluded'}</small></article>
            <article className="reports-kpi"><span>Average bill</span><strong>{money(summary.avg_bill_value)}</strong><small>Net sales ÷ bills</small></article>
            <article className="reports-kpi"><span>Discount given</span><strong>{money(summary.total_discount)}</strong><small>Across this date range</small></article>
            <article className="reports-kpi reports-kpi-credit"><span>Current outstanding</span><strong>{money(due.total_due)}</strong><small>All open bills · any date</small></article>
          </section>

          {Number(summary.unclassified_split_amount || 0) > 0 && <div className="reports-note" role="status">Some older split bills do not contain payment details. {money(summary.unclassified_split_amount)} is left unassigned instead of being guessed.</div>}

          <section className="reports-content-grid">
            <article className="reports-card reports-trend-card">
              <div className="reports-card-heading"><div><h2>Sales by day</h2><p>Net invoice totals · latest 45 days in this selection</p></div></div>
              {dailyRows.length ? <div className="reports-day-chart" role="img" aria-label="Daily net sales bar chart">{dailyRows.map((item) => <div className="reports-day-column" key={String(item.date)} title={`${formatDate(item.date)} · ${money(item.sales)} · ${item.bills} bills`}><div className="reports-day-bar-wrap"><div className="reports-day-bar" style={{ height: `${Math.max((Number(item.sales || 0) / maximumDay) * 100, 3)}%` }} /></div><span>{formatDate(item.date, { day: '2-digit', month: 'short' })}</span></div>)}</div> : <div className="reports-empty">No sales in this date range.</div>}
            </article>

            <article className="reports-card">
              <div className="reports-card-heading"><div><h2>Payment split</h2><p>Cash, UPI and credit portions from saved bill payment details</p></div></div>
              <div className="reports-payment-list">{paymentRows.length ? paymentRows.map((item) => <div className="reports-payment-row" key={item.payment_method}><div className="reports-payment-label"><span>{item.payment_method === 'credit' ? 'Credit billed' : item.payment_method.toUpperCase()}</span><strong>{money(item.amount)}</strong></div><div className="reports-meter"><span style={{ width: `${Math.max((Number(item.amount || 0) / maximumPayment) * 100, 1)}%` }} /></div><small>{Number(item.bills || 0)} bills with this payment part</small></div>) : <div className="reports-empty">No payment totals for these filters.</div>}</div>
            </article>

            <article className="reports-card">
              <div className="reports-card-heading"><div><h2>Top products</h2><p>Quantities sold · bill discounts shared across items proportionally</p></div><button className="reports-link-button" onClick={() => setTab('products')}>Full view →</button></div>
              <div className="reports-compact-list">{(analytics.topProducts || []).slice(0, 5).map((item, index) => <div className="reports-ranked-row" key={item.id}><span className="reports-rank">{index + 1}</span><span className="reports-ranked-name">{item.name}<small>{item.total_qty} {item.unit || 'units'}</small></span><strong>{money(item.net_revenue)}</strong></div>)}{!analytics.topProducts?.length && <div className="reports-empty">No product sales in this date range.</div>}</div>
            </article>

            {(user.role === 'admin' || user.role === 'manager') && <article className="reports-card">
              <div className="reports-card-heading"><div><h2>Staff sales</h2><p>Net invoice sales and bill count</p></div></div>
              <div className="reports-compact-list">{(analytics.cashierBreakdown || []).slice(0, 6).map((item) => <div className="reports-ranked-row" key={item.user_id || item.cashier_name}><span className="reports-staff-avatar">{String(item.cashier_name || '?').slice(0, 1).toUpperCase()}</span><span className="reports-ranked-name">{item.cashier_name}<small>{item.bills} bills</small></span><strong>{money(item.net_sales)}</strong></div>)}{!analytics.cashierBreakdown?.length && <div className="reports-empty">No bills in this date range.</div>}</div>
            </article>}
          </section>
        </>}

        {tab === 'sales' && <section className="reports-card reports-sales-card">
          <div className="reports-card-heading"><div><h2>Sales bills</h2><p>{pagination.total.toLocaleString('en-IN')} matching bills · export downloads the current page</p></div></div>
          <div className="reports-table-wrap"><table className="reports-sales-table"><thead><tr><th>Bill</th><th>Date</th><th>Customer</th><th>Cashier</th><th>Payment</th><th>Net total</th><th>Paid</th><th>Due</th><th></th></tr></thead><tbody>
            {analytics.recentSales.map((sale) => <tr key={sale.id}><td className="reports-bill-number">{sale.bill_number}</td><td>{formatDate(sale.created_at, { day: '2-digit', month: 'short', year: '2-digit' })}</td><td>{sale.customer_name}</td><td>{sale.cashier_name}</td><td><span className="reports-payment-chip">{String(sale.payment_method).toUpperCase()}</span></td><td>{money(sale.total_amount)}</td><td>{money(sale.amount_paid)}</td><td className={Number(sale.balance_due) > 0 ? 'reports-due-value' : ''}>{money(sale.balance_due)}</td><td><button className="btn btn-sm btn-secondary" onClick={() => downloadBillPdf(sale.id)}>Bill PDF</button></td></tr>)}
          </tbody></table>{!analytics.recentSales.length && <div className="reports-empty">No bills match these filters.</div>}</div>
          <div className="reports-pagination"><span>Page {pagination.page} of {Math.max(1, pagination.totalPages)}</span><div><button className="btn btn-secondary" disabled={page <= 1 || loading} onClick={() => loadReports(page - 1)}>Previous</button><button className="btn btn-secondary" disabled={page >= pagination.totalPages || loading} onClick={() => loadReports(page + 1)}>Next</button></div></div>
        </section>}

        {tab === 'products' && <section className="reports-content-grid reports-product-grid">
          <article className="reports-card"><div className="reports-card-heading"><div><h2>Best-selling products</h2><p>Sorted by quantity sold in the selected period</p></div></div><div className="reports-table-wrap"><table><thead><tr><th>Product</th><th>Qty sold</th><th>Bills</th><th>Net sales</th></tr></thead><tbody>{(analytics.topProducts || []).map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.total_qty} {item.unit}</td><td>{item.bill_count}</td><td>{money(item.net_revenue)}</td></tr>)}</tbody></table>{!analytics.topProducts?.length && <div className="reports-empty">No product sales in this date range.</div>}</div></article>
          <article className="reports-card"><div className="reports-card-heading"><div><h2>Sales by category</h2><p>Net item sales after discount allocation</p></div></div><div className="reports-table-wrap"><table><thead><tr><th>Category</th><th>Qty sold</th><th>Net sales</th></tr></thead><tbody>{(analytics.categoryBreakdown || []).map((item) => <tr key={item.category_id || item.category_name}><td>{item.category_name}</td><td>{item.qty}</td><td>{money(item.net_sales)}</td></tr>)}</tbody></table>{!analytics.categoryBreakdown?.length && <div className="reports-empty">No category sales in this date range.</div>}</div></article>
          <article className="reports-card reports-profit-placeholder"><h2>Profit reporting</h2><p>Actual profit is hidden until the app records each item's purchase cost at the time of sale. Current product costs can change later, so using them for old bills would give a misleading number.</p></article>
        </section>}

        {tab === 'credit' && <section className="reports-credit-layout">
          <div className="reports-credit-header"><div><span className="reports-eyebrow">ALL UNPAID BILLS</span><h2>Outstanding udhaar</h2><p>This view uses current balances across all dates. The sales date filter does not hide older unpaid bills.</p></div><strong>{money(due.total_due)}</strong></div>
          <section className="reports-credit-buckets"><article><span>0–7 days</span><strong>{money(due.bucket_0_7)}</strong></article><article><span>8–30 days</span><strong>{money(due.bucket_8_30)}</strong></article><article><span>30+ days</span><strong>{money(due.bucket_30_plus)}</strong></article></section>
          <article className="reports-card"><div className="reports-card-heading"><div><h2>Customers with due bills</h2><p>Open bill balances grouped by customer</p></div></div><div className="reports-table-wrap"><table><thead><tr><th>Customer</th><th>Phone</th><th>Oldest due</th><th>Outstanding</th></tr></thead><tbody>{(analytics.overdueCustomers || []).map((item) => <tr key={item.customer_id || item.customer_name}><td>{item.customer_name}</td><td>{item.customer_phone}</td><td>{formatDate(item.oldest_due_date)}</td><td className="reports-due-value">{money(item.due_amount)}</td></tr>)}</tbody></table>{!analytics.overdueCustomers?.length && <div className="reports-empty">No outstanding customer balances.</div>}</div></article>
        </section>}
      </>}

      {loading && analytics && <div className="reports-loading-strip" role="status">Updating report…</div>}
      <InfoModal isOpen={infoModal.isOpen} title={infoModal.title} message={infoModal.message} onClose={() => setInfoModal({ isOpen: false, title: '', message: '' })} />
    </main>
  )
}

export default Reports
