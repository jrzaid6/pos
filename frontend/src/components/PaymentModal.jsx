import { useState, useEffect } from 'react'
import api from '../services/api'

function PaymentModal({ customer, onClose, onSuccess }) {
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [unpaidBills, setUnpaidBills] = useState([])
  const [selectedBillId, setSelectedBillId] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (customer?.id) {
      loadUnpaidBills()
    }
  }, [customer])

  const loadUnpaidBills = async () => {
    try {
      const res = await api.get(`/credits/customer/${customer.id}/unpaid-bills`)
      setUnpaidBills(res.data)
    } catch (err) {
      console.error('Failed to load unpaid bills:', err)
    }
  }

  const handleBillSelect = (e) => {
    const billId = e.target.value
    setSelectedBillId(billId)
    
    // Auto-fill amount if a specific bill is selected
    if (billId) {
      const bill = unpaidBills.find(b => b.id.toString() === billId)
      if (bill) {
        setAmount(bill.balance_due)
      }
    } else {
      setAmount('')
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!amount || parseFloat(amount) <= 0) return

    setLoading(true)
    try {
      await api.post('/credits/payment', {
        customer_id: customer.id,
        amount: parseFloat(amount),
        payment_method: paymentMethod,
        bill_id: selectedBillId || null,
        notes: notes || (selectedBillId ? `Payment for Bill #${unpaidBills.find(b => b.id == selectedBillId)?.bill_number}` : 'On Account Payment')
      })
      onSuccess()
      onClose()
    } catch (err) {
      alert('Failed to record payment')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Record Payment</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <div className="payment-summary-card">
              <div className="summary-row">
                <span>Customer:</span>
                <strong>{customer.name}</strong>
              </div>
              <div className="summary-row">
                <span>Total Pending:</span>
                <strong className="text-danger">₹{parseFloat(customer.pending_balance).toFixed(2)}</strong>
              </div>
            </div>

            <div className="form-group">
              <label>Settle Against Bill (Optional)</label>
              <select 
                value={selectedBillId} 
                onChange={handleBillSelect}
                className="form-control"
              >
                <option value="">-- General Payment (On Account) --</option>
                {unpaidBills.map(bill => (
                  <option key={bill.id} value={bill.id}>
                    {bill.bill_number} - Due: ₹{bill.balance_due} (Date: {new Date(bill.created_at).toLocaleDateString()})
                  </option>
                ))}
              </select>
              <small className="form-text text-muted">
                Select a bill to settle specific invoice, or leave empty for general credit payment.
              </small>
            </div>

            <div className="form-row">
              <div className="form-group col">
                <label>Amount *</label>
                <div className="input-group">
                  <span className="input-prefix">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    required
                    min="1"
                    className="form-control"
                  />
                </div>
              </div>
              
              <div className="form-group col">
                <label>Payment Method</label>
                <select 
                  value={paymentMethod} 
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="form-control"
                >
                  <option value="cash">Cash</option>
                  <option value="upi">UPI / Bank</option>
                </select>
              </div>
            </div>

            <div className="form-group">
              <label>Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes..."
                rows="2"
                className="form-control"
              />
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Processing...' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default PaymentModal
