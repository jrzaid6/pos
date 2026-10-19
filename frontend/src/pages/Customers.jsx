import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import api from '../services/api'
import ConfirmModal from '../components/ConfirmModal'
import InfoModal from '../components/InfoModal'

function Customers() {
  const [customers, setCustomers] = useState([])
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [history, setHistory] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editCustomer, setEditCustomer] = useState(null)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({
    name: '',
    phone: '',
    address: '',
    customer_type: 'wholesale',
    gst_number: ''
  })
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [infoModal, setInfoModal] = useState({ isOpen: false, title: '', message: '' })
  const [shopSettings, setShopSettings] = useState({})

  useEffect(() => {
    loadCustomers()
  }, [])

  const showInfo = (title, message) => setInfoModal({ isOpen: true, title, message })

  const loadCustomers = async () => {
    try {
      const [customersRes, settingsRes] = await Promise.all([
        api.get('/customers'),
        api.get('/settings')
      ])
      setCustomers(customersRes.data)
      setShopSettings(settingsRes.data)
      if (selectedCustomer) {
        const fresh = customersRes.data.find(c => c.id === selectedCustomer.id)
        if (fresh) setSelectedCustomer(fresh)
      }
    } catch (err) {
      console.error('Load error:', err)
    }
  }

  const loadCustomerHistory = async (customer) => {
    setSelectedCustomer(customer)
    try {
      const res = await api.get(`/customers/${customer.id}/history`)
      setHistory(res.data)
    } catch (err) {
      console.error('History error:', err)
      setHistory([])
    }
  }

  const openModal = (customer = null) => {
    if (customer) {
      setEditCustomer(customer)
      setForm({
        name: customer.name || '',
        phone: customer.phone || '',
        address: customer.address || '',
        customer_type: customer.customer_type || 'wholesale',
        gst_number: customer.gst_number || ''
      })
    } else {
      setEditCustomer(null)
      setForm({
        name: '',
        phone: '',
        address: '',
        customer_type: 'wholesale',
        gst_number: ''
      })
    }
    setShowModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const payload = {
        ...form,
        gst_number: form.gst_number || null,
        shop_name: null,
        contact_person: null,
        area: null,
        credit_limit: 0,
        opening_balance: 0,
        notes: null
      }

      if (editCustomer) {
        await api.put(`/customers/${editCustomer.id}`, payload)
      } else {
        await api.post('/customers', payload)
      }
      setShowModal(false)
      loadCustomers()
      showInfo('Success', `Customer ${editCustomer ? 'updated' : 'created'} successfully`)
    } catch (err) {
      showInfo('Error', err.response?.data?.error || 'Failed to save customer')
    }
  }

  const confirmDelete = (customer) => {
    setDeleteTarget(customer)
    setShowDeleteConfirm(true)
  }

  const deleteCustomer = async () => {
    if (!deleteTarget) return
    try {
      await api.delete(`/customers/${deleteTarget.id}`)
      if (selectedCustomer?.id === deleteTarget.id) {
        setSelectedCustomer(null)
        setHistory([])
      }
      loadCustomers()
      setShowDeleteConfirm(false)
      setDeleteTarget(null)
    } catch (err) {
      showInfo('Error', err.response?.data?.error || 'Failed to delete customer')
    }
  }

  const downloadHistoryInvoice = (entry) => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    let y = 20

    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.text(shopSettings.shop_name || 'MMTC POS', 105, y, { align: 'center' })
    y += 8

    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    if (shopSettings.address) {
      const addressLines = doc.splitTextToSize(shopSettings.address, 160)
      doc.text(addressLines, 105, y, { align: 'center' })
      y += addressLines.length * 5
    }
    if (shopSettings.phone) {
      doc.text(`Ph: ${shopSettings.phone}`, 105, y, { align: 'center' })
      y += 5
    }
    if (shopSettings.gst_number) {
      doc.text(`GST: ${shopSettings.gst_number}`, 105, y, { align: 'center' })
      y += 5
    }

    doc.line(20, y, 190, y)
    y += 8
    doc.text(`Bill: ${entry.bill_number}`, 20, y)
    y += 6
    doc.text(`Date: ${new Date(entry.created_at).toLocaleString()}`, 20, y)
    y += 6
    doc.text(`Customer: ${selectedCustomer?.name || 'Walk-in'}`, 20, y)
    y += 8
    doc.line(20, y, 190, y)
    y += 8

    doc.setFont('helvetica', 'bold')
    doc.text('Item', 20, y)
    doc.text('Qty', 120, y)
    doc.text('Rate', 145, y)
    doc.text('Total', 170, y)
    y += 6
    doc.setFont('helvetica', 'normal')

    ;(entry.items || []).forEach(item => {
      const itemLines = doc.splitTextToSize(String(item.product_name || ''), 85)
      doc.text(itemLines, 20, y)
      doc.text(String(item.quantity || 0), 120, y)
      doc.text(`Rs.${Number(item.price || 0).toFixed(2)}`, 145, y)
      doc.text(`Rs.${Number(item.total || 0).toFixed(2)}`, 170, y)
      y += Math.max(itemLines.length * 5, 6)
    })

    y += 4
    doc.line(20, y, 190, y)
    y += 8
    doc.setFont('helvetica', 'bold')
    doc.text(`TOTAL: Rs.${Number(entry.total_amount || 0).toFixed(2)}`, 20, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    doc.text(`Payment: ${String(entry.payment_method || '').toUpperCase()}`, 20, y)

    doc.save(`${entry.bill_number}.pdf`)
  }

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      return [c.name, c.phone, c.gst_number].some(value =>
        String(value || '').toLowerCase().includes(search.toLowerCase())
      )
    })
  }, [customers, search])

  const summary = useMemo(() => ({
    totalCustomers: filteredCustomers.length,
    totalPurchase: filteredCustomers.reduce((sum, c) => sum + Number(c.total_purchase || 0), 0),
    totalOrders: filteredCustomers.reduce((sum, c) => sum + Number(c.total_orders || 0), 0),
    customersWithDue: filteredCustomers.filter(c => Number(c.pending_balance || 0) > 0).length
  }), [filteredCustomers])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 3rem)' }}>
      <div className="page-header">
        <div>
          <h1>Customers</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
            Manage customers, balances and purchase history.
          </p>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1rem' }}>
        <div className="stat-card">
          <h3>Total Customers</h3>
          <div className="value">{summary.totalCustomers}</div>
        </div>
        <div className="stat-card upi">
          <h3>Total Business</h3>
          <div className="value">₹{summary.totalPurchase.toFixed(2)}</div>
        </div>
        <div className="stat-card cash">
          <h3>Total Orders</h3>
          <div className="value">{summary.totalOrders}</div>
        </div>
        <div className="stat-card udhar">
          <h3>Customers With Due</h3>
          <div className="value">{summary.customersWithDue}</div>
        </div>
      </div>

      <div className="search-bar" style={{ marginBottom: '1rem' }}>
        <input
          type="text"
          placeholder="Search by name, phone, GST..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 0.95fr', gap: '1.25rem', flex: 1, minHeight: 0 }}>
        <div className="data-table" style={{ flex: 1, height: '500px', overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>No.</th>
                <th>Customer</th>
                <th>Type</th>
                <th>Balance</th>
                <th>Orders</th>
                <th>Last Order</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((customer, index) => {
                const balance = Number(customer.pending_balance || 0)
                const hasDue = balance > 0
                const hasAdvance = balance < 0

                return (
                  <tr
                    key={customer.id}
                    style={{ cursor: 'pointer', background: selectedCustomer?.id === customer.id ? 'rgba(46, 168, 255, 0.1)' : '' }}
                    onClick={() => loadCustomerHistory(customer)}
                  >
                    <td>{index + 1}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{customer.name}</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{customer.phone || '-'}</div>
                    </td>
                    <td style={{ textTransform: 'capitalize' }}>{customer.customer_type || 'wholesale'}</td>
                    <td>
                      <div style={{ fontWeight: 700, color: hasDue ? 'var(--warning)' : hasAdvance ? 'var(--primary)' : 'var(--text-primary)' }}>
                        ₹{Math.abs(balance).toFixed(2)}
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                        {hasDue ? 'Pending' : hasAdvance ? 'Advance' : 'Clear'}
                      </div>
                    </td>
                    <td>
                      <div>{customer.total_orders}</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>₹{Number(customer.total_purchase || 0).toFixed(0)}</div>
                    </td>
                    <td>{customer.last_order_date ? new Date(customer.last_order_date).toLocaleDateString() : '-'}</td>
                    <td>
                      <div className="action-buttons" onClick={(e) => e.stopPropagation()}>
                        <button className="btn btn-sm btn-secondary" onClick={() => openModal(customer)}>Edit</button>
                        <button className="btn btn-sm btn-danger" onClick={() => confirmDelete(customer)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filteredCustomers.length === 0 && (
                <tr>
                  <td colSpan="7" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                    No customers found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="data-table" style={{ padding: '1.25rem', height: '500px', overflowY: 'auto' }}>
          {selectedCustomer ? (
            <>
              <div style={{ marginBottom: '1rem' }}>
                <h2 style={{ marginBottom: '0.5rem' }}>{selectedCustomer.name}</h2>
                <div style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                  <div>Phone: {selectedCustomer.phone || '-'}</div>
                  <div>Type: <span style={{ textTransform: 'capitalize' }}>{selectedCustomer.customer_type || 'wholesale'}</span></div>
                  <div>GST: {selectedCustomer.gst_number || '-'}</div>
                </div>
              </div>

              <div className="stats-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr', marginBottom: '1rem' }}>
                <div className="stat-card" style={{ padding: '1rem' }}>
                  <h3>Total Orders</h3>
                  <div className="value" style={{ fontSize: '1.25rem' }}>{selectedCustomer.total_orders || 0}</div>
                </div>
                <div className="stat-card" style={{ padding: '1rem' }}>
                  <h3>Total Purchase</h3>
                  <div className="value" style={{ fontSize: '1.25rem' }}>₹{Number(selectedCustomer.total_purchase || 0).toFixed(2)}</div>
                </div>
                <div className="stat-card" style={{ padding: '1rem' }}>
                  <h3>{Number(selectedCustomer.pending_balance || 0) > 0 ? 'Pending' : Number(selectedCustomer.pending_balance || 0) < 0 ? 'Advance' : 'Balance'}</h3>
                  <div className="value" style={{ fontSize: '1.25rem', color: Number(selectedCustomer.pending_balance || 0) > 0 ? 'var(--warning)' : Number(selectedCustomer.pending_balance || 0) < 0 ? 'var(--primary)' : 'var(--text-primary)' }}>
                    ₹{Math.abs(Number(selectedCustomer.pending_balance || 0)).toFixed(2)}
                  </div>
                </div>
              </div>

              <h3 style={{ marginBottom: '0.75rem' }}>Purchase History</h3>
              <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
                {history.length > 0 ? history.map(entry => (
                  <div key={entry.id} style={{ border: '1px solid var(--border)', borderRadius: '10px', padding: '0.85rem', marginBottom: '0.75rem', background: 'var(--bg-input)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem', gap: '0.5rem' }}>
                      <strong>{entry.bill_number}</strong>
                      <strong>₹{Number(entry.total_amount).toFixed(2)}</strong>
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.35rem' }}>
                      {new Date(entry.created_at).toLocaleString()} • {String(entry.payment_method).toUpperCase()}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                      {(entry.items || []).map(item => `${item.product_name} x${item.quantity}`).join(', ') || 'No items'}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <button className="btn btn-sm btn-warning" style={{ width: 'auto', padding: '0.4rem 0.75rem' }} onClick={() => downloadHistoryInvoice(entry)}>
                        Bill PDF
                      </button>
                    </div>
                  </div>
                )) : (
                  <div className="empty-state">No purchase history</div>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">Select a customer to view details and purchase history</div>
          )}
        </div>
      </div>

      <div style={{ 
        position: 'sticky', 
        bottom: 0, 
        padding: '1.5rem 0 0 0', 
        background: 'var(--bg-dark)', 
        marginTop: '1rem'
      }}>
        <button className="btn btn-primary" onClick={() => openModal()} style={{ padding: '1.1rem 1.5rem', fontSize: '1.1rem', width: '100%' }}>
          Add Customer
        </button>
      </div>

      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="Delete Customer"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This will also remove all their sales and credit records.`}
        confirmText="Yes, Delete"
        cancelText="Cancel"
        type="danger"
        onConfirm={deleteCustomer}
        onCancel={() => {
          setShowDeleteConfirm(false)
          setDeleteTarget(null)
        }}
      />

      <InfoModal
        isOpen={infoModal.isOpen}
        title={infoModal.title}
        message={infoModal.message}
        onClose={() => setInfoModal({ isOpen: false, title: '', message: '' })}
      />

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" style={{ maxWidth: '640px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editCustomer ? 'Edit Customer' : 'Add Customer'}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Name *</label>
                    <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label>Phone</label>
                    <input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Customer Type</label>
                    <select value={form.customer_type} onChange={(e) => setForm({ ...form, customer_type: e.target.value })}>
                      <option value="wholesale">Wholesale</option>
                      <option value="retail">Retail</option>
                      <option value="regular">Regular</option>
                      <option value="vip">VIP</option>
                      <option value="distributor">Distributor</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>GST Number (Optional)</label>
                    <input type="text" value={form.gst_number} onChange={(e) => setForm({ ...form, gst_number: e.target.value })} />
                  </div>
                  <div className="form-group" style={{ gridColumn: 'span 2' }}>
                    <label>Address</label>
                    <input type="text" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Customers
