import { useState, useEffect, useMemo } from 'react'
import { jsPDF } from 'jspdf'
import api from '../services/api'
import PaymentModal from '../components/PaymentModal'

function Credits() {
  const [pendingCredits, setPendingCredits] = useState([])
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [ledger, setLedger] = useState([])
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [totalPending, setTotalPending] = useState(0)
  const [shopSettings, setShopSettings] = useState({})

  useEffect(() => {
    loadCredits()
  }, [])

  const loadCredits = async () => {
    try {
      const [pendingRes, totalRes, settingsRes] = await Promise.all([
        api.get('/credits/pending'),
        api.get('/credits/total'),
        api.get('/settings')
      ])
      setPendingCredits(pendingRes.data)
      setTotalPending(totalRes.data.total_pending)
      setShopSettings(settingsRes.data)
    } catch (err) {
      console.error('Load error:', err)
    }
  }

  const loadLedger = async (customer) => {
    setSelectedCustomer(customer)
    try {
      const res = await api.get(`/credits/customer/${customer.id}`)
      setLedger(res.data)
    } catch (err) {
      console.error('Load error:', err)
    }
  }

  const handlePaymentSuccess = () => {
    loadCredits()
    if (selectedCustomer) {
      loadLedger(selectedCustomer)
    }
  }

  const downloadUdharPDF = () => {
    const doc = new jsPDF()
    let y = 20

    // Header
    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.text(shopSettings.shop_name || 'Shop', 105, y, { align: 'center' })
    y += 8

    doc.setFontSize(14)
    doc.text('Credit Report', 105, y, { align: 'center' })
    y += 6

    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(`Generated: ${new Date().toLocaleString()}`, 105, y, { align: 'center' })
    y += 10

    // Total
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text(`Total Pending: Rs.${totalPending.toFixed(2)}`, 105, y, { align: 'center' })
    y += 10

    // Line
    doc.setLineWidth(0.5)
    doc.line(20, y, 190, y)
    y += 10

    // Table header
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('Customer', 20, y)
    doc.text('Phone', 100, y)
    doc.text('Pending Amount', 150, y)
    y += 6

    // Table rows
    doc.setFont('helvetica', 'normal')
    pendingCredits.forEach(customer => {
      if (y > 270) {
        doc.addPage()
        y = 20
      }
      doc.text(customer.name.substring(0, 35), 20, y)
      doc.text(customer.phone || '-', 100, y)
      doc.text(`Rs.${parseFloat(customer.pending_balance).toFixed(2)}`, 150, y)
      y += 6
    })

    doc.save(`Credit_Report_${new Date().toISOString().split('T')[0]}.pdf`)
  }

  const customerCount = pendingCredits.length
  const totalEntries = ledger.length
  const totalCollected = useMemo(
    () => ledger
      .filter(entry => entry.payment_type !== 'credit')
      .reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
    [ledger]
  )
  const currentOutstanding = Number(selectedCustomer?.pending_balance || 0)

  const downloadCustomerLedgerPDF = () => {
    if (!selectedCustomer || ledger.length === 0) return

    const doc = new jsPDF()
    let y = 20

    // Header
    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.text(shopSettings.shop_name || 'Shop', 105, y, { align: 'center' })
    y += 8

    doc.setFontSize(14)
    doc.text('Customer Ledger', 105, y, { align: 'center' })
    y += 10

    // Customer info
    doc.setFontSize(12)
    doc.setFont('helvetica', 'normal')
    doc.text(`Customer: ${selectedCustomer.name}`, 20, y)
    y += 6
    doc.text(`Phone: ${selectedCustomer.phone || '-'}`, 20, y)
    y += 6
    doc.setFont('helvetica', 'bold')
    doc.text(`Pending Balance: Rs.${parseFloat(selectedCustomer.pending_balance).toFixed(2)}`, 20, y)
    y += 10

    // Line
    doc.line(20, y, 190, y)
    y += 8

    // Table header
    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.text('Date', 20, y)
    doc.text('Type', 60, y)
    doc.text('Bill #', 100, y)
    doc.text('Amount', 150, y)
    y += 6

    // Ledger entries (oldest first for readable statement flow)
    doc.setFont('helvetica', 'normal')
    const orderedLedger = [...ledger].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    orderedLedger.forEach(entry => {
      if (y > 270) {
        doc.addPage()
        y = 20
      }
      doc.text(new Date(entry.created_at).toLocaleDateString(), 20, y)
      doc.text(entry.payment_type === 'credit' ? 'Credit' : 'Payment', 60, y)
      doc.text(entry.bill_number || '-', 100, y)
      const sign = entry.payment_type === 'credit' ? '-' : '+'
      doc.text(`${sign}Rs.${Number(entry.amount || 0).toFixed(2)}`, 150, y)
      y += 6
    })

    doc.save(`Ledger_${selectedCustomer.name}_${new Date().toISOString().split('T')[0]}.pdf`)
  }

  return (
    <div className="credit-page">
      <div className="page-header credit-page-header">
        <div>
          <h1>Credit</h1>
          <p className="credit-page-subtitle">Track pending balances, customer ledgers and payment recovery in one place.</p>
        </div>
        <button className="btn btn-warning" onClick={downloadUdharPDF}>Download All PDF</button>
      </div>

      <div className="credit-summary-grid">
        <div className="credit-summary-card credit-summary-total">
          <span className="credit-summary-label">Total Pending</span>
          <strong className="credit-summary-value">₹{totalPending.toFixed(2)}</strong>
          <span className="credit-summary-note">Overall outstanding across all customers</span>
        </div>
        <div className="credit-summary-card">
          <span className="credit-summary-label">Pending Customers</span>
          <strong className="credit-summary-value">{customerCount}</strong>
          <span className="credit-summary-note">Customers currently carrying due balance</span>
        </div>
        <div className="credit-summary-card">
          <span className="credit-summary-label">Ledger Entries</span>
          <strong className="credit-summary-value">{selectedCustomer ? totalEntries : 0}</strong>
          <span className="credit-summary-note">{selectedCustomer ? `Transactions for ${selectedCustomer.name}` : 'Select a customer to inspect ledger'}</span>
        </div>
      </div>

      <div className="credit-layout-grid">
        <section className="credit-panel credit-customers-panel">
          <div className="credit-panel-header">
            <div>
              <h2>Pending Customers</h2>
              <p>Click any customer to open their credit ledger.</p>
            </div>
            <div className="credit-panel-badge">{customerCount} active</div>
          </div>

          <div className="credit-customers-table-wrap data-table">
            <table>
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th>Pending</th>
                </tr>
              </thead>
              <tbody>
                {pendingCredits.map(customer => (
                  <tr
                    key={customer.id}
                    onClick={() => loadLedger(customer)}
                    className={selectedCustomer?.id === customer.id ? 'credit-row-active' : ''}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <div className="credit-customer-name">{customer.name}</div>
                      <div className="credit-customer-hint">Tap to view full ledger</div>
                    </td>
                    <td>{customer.phone || '-'}</td>
                    <td>
                      <span className="credit-amount-pill warning">₹{parseFloat(customer.pending_balance).toFixed(2)}</span>
                    </td>
                  </tr>
                ))}
                {pendingCredits.length === 0 && (
                  <tr>
                    <td colSpan="3" className="empty-state">No pending credits</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="credit-panel credit-ledger-panel">
          {selectedCustomer ? (
            <>
              <div className="credit-panel-header credit-ledger-header">
                <div>
                  <h2>{selectedCustomer.name}'s Ledger</h2>
                  <p>{selectedCustomer.phone || 'No phone'} • Payment history and credit entries</p>
                </div>
                <div className="credit-header-actions">
                  <button className="btn btn-warning btn-sm" onClick={() => downloadCustomerLedgerPDF()}>PDF</button>
                  <button className="btn btn-primary" onClick={() => setShowPaymentModal(true)}>
                    + Record Payment
                  </button>
                </div>
              </div>

              <div className="credit-ledger-stats">
                <div className="credit-mini-stat">
                  <span>Outstanding</span>
                  <strong>₹{currentOutstanding.toFixed(2)}</strong>
                </div>
                <div className="credit-mini-stat success">
                  <span>Collected</span>
                  <strong>₹{totalCollected.toFixed(2)}</strong>
                </div>
                <div className="credit-mini-stat neutral">
                  <span>Entries</span>
                  <strong>{totalEntries}</strong>
                </div>
              </div>

              <div className="credit-ledger-table data-table">
                <table className="ledger-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Bill</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.length > 0 ? ledger.map(entry => (
                      <tr key={entry.id}>
                        <td>{new Date(entry.created_at).toLocaleDateString()}</td>
                        <td>
                          <span className={`credit-type-badge ${entry.payment_type === 'credit' ? 'credit' : 'payment'}`}>
                            {entry.payment_type === 'credit' ? 'Credit' : 'Payment'}
                          </span>
                        </td>
                        <td>{entry.bill_number || '-'}</td>
                        <td style={{ color: entry.payment_type === 'credit' ? 'var(--danger)' : 'var(--primary)', fontWeight: 700 }}>
                          {entry.payment_type === 'credit' ? '+' : '-'}₹{entry.amount}
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan="4" className="empty-state">No ledger entries available for this customer</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="credit-empty-panel">
              <div className="credit-empty-icon">₹</div>
              <h2>Select a customer</h2>
              <p>Choose any pending customer from the left side to view their detailed credit ledger and record payment.</p>
            </div>
          )}
        </section>
      </div>

      {/* Payment Modal */}
      {showPaymentModal && selectedCustomer && (
        <PaymentModal 
          customer={selectedCustomer}
          onClose={() => setShowPaymentModal(false)}
          onSuccess={handlePaymentSuccess}
        />
      )}
    </div>
  )
}

export default Credits
