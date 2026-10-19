import { useEffect, useMemo, useRef, useState } from 'react'
import { jsPDF } from 'jspdf'
import api from '../services/api'
import InfoModal from '../components/InfoModal'

const PAYMENT_METHODS = [
  { key: 'cash', label: 'Cash', className: 'cash' },
  { key: 'upi', label: 'UPI', className: 'upi' },
  { key: 'udhar', label: 'Credit', className: 'udhar' },
  { key: 'split', label: 'Split', className: 'split' }
]

const formatCurrency = (value) => `₹${Number(value || 0).toFixed(2)}`

const clampNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

const getUnitLabel = (unit) => {
  if (!unit) return 'unit'
  return String(unit).toLowerCase()
}

const getDefaultStockSource = (product) => (Number(product.bank_stock || 0) > 0 ? 'bank' : 'cash')
const getAvailableStockForSource = (product, source) => Number(source === 'cash' ? product.cash_stock : product.bank_stock)

function POS({ user }) {
  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [recentSales, setRecentSales] = useState([])
  const [cart, setCart] = useState([])
  const [search, setSearch] = useState('')
  const [barcode, setBarcode] = useState('')
  const [selectedCustomer, setSelectedCustomer] = useState('')
  const [customerNameInput, setCustomerNameInput] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [discount, setDiscount] = useState('0')
  const [cashReceived, setCashReceived] = useState('0')
  const [splitPayments, setSplitPayments] = useState({ cash: '', upi: '', credit: '' })
  const [billNotes, setBillNotes] = useState('')
  const [showCheckoutModal, setShowCheckoutModal] = useState(false)
  const [showBill, setShowBill] = useState(false)
  const [lastBill, setLastBill] = useState(null)
  const [shopSettings, setShopSettings] = useState({})
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [infoModal, setInfoModal] = useState({ isOpen: false, title: '', message: '' })

  const barcodeRef = useRef(null)
  const searchRef = useRef(null)

  const canOverridePrice = user?.role === 'admin' || user?.role === 'manager'
  const showInfo = (title, message) => setInfoModal({ isOpen: true, title, message })

  useEffect(() => {
    loadData()

    const saved = localStorage.getItem('posBillingDraft')
    if (saved) {
      try {
        const draft = JSON.parse(saved)
        setCart(draft.cart || [])
        setSelectedCustomer(draft.selectedCustomer || '')
        setCustomerNameInput(draft.customerNameInput || '')
        setPaymentMethod(draft.paymentMethod || 'cash')
        setDiscount(draft.discount || '0')
        setCashReceived(draft.cashReceived || '0')
        setSplitPayments(draft.splitPayments || { cash: '', upi: '', credit: '' })
        setBillNotes(draft.billNotes || '')
      } catch {}
    }
    setDraftLoaded(true)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      barcodeRef.current?.focus()
    }, 150)

    return () => {
      clearTimeout(timer)
    }
  }, [cart])

  useEffect(() => {
    if (!draftLoaded) return
    localStorage.setItem('posBillingDraft', JSON.stringify({
      cart,
      selectedCustomer,
      customerNameInput,
      paymentMethod,
      discount,
      cashReceived,
      splitPayments,
      billNotes
    }))
  }, [draftLoaded, cart, selectedCustomer, customerNameInput, paymentMethod, discount, cashReceived, splitPayments, billNotes])

  const loadData = async () => {
    try {
      setLoading(true)
      const [productsRes, customersRes, settingsRes, salesRes] = await Promise.all([
        api.get('/products'),
        api.get('/customers'),
        api.get('/settings'),
        api.get('/sales?limit=8')
      ])
      setProducts(productsRes.data)
      setCustomers(customersRes.data)
      setShopSettings(settingsRes.data)
      setRecentSales(salesRes.data)
    } catch (err) {
      console.error('Load error:', err)
    } finally {
      setLoading(false)
    }
  }

  const selectedCustomerData = useMemo(
    () => customers.find((customer) => String(customer.id) === String(selectedCustomer)) || null,
    [customers, selectedCustomer]
  )

  const subtotal = useMemo(
    () => cart.reduce((sum, item) => sum + (Number(item.price) * Number(item.quantity)), 0),
    [cart]
  )

  const discountValue = canOverridePrice ? Math.min(Math.max(clampNumber(discount), 0), subtotal) : 0
  const total = Math.max(subtotal - discountValue, 0)
  const splitCash = clampNumber(splitPayments.cash)
  const splitUpi = clampNumber(splitPayments.upi)
  const splitCredit = Math.max(total - (splitCash + splitUpi), 0)
  const splitTotal = splitCash + splitUpi + splitCredit
  const cashReceivedValue = clampNumber(cashReceived)

  const paymentSummary = useMemo(() => {
    if (paymentMethod === 'split') {
      const paid = Math.min(splitCash + splitUpi, total)
      const balance = Math.max(total - paid, 0)
      return {
        amountPaid: paid,
        balanceDue: Math.max(balance, splitCredit),
        changeReturn: 0,
        paymentStatus: balance > 0 ? (paid > 0 ? 'partial' : 'pending') : 'paid',
        paymentBreakdown: {
          cash: splitCash,
          upi: splitUpi,
          credit: Math.max(splitCredit, Math.max(total - (splitCash + splitUpi), 0))
        }
      }
    }

    if (paymentMethod === 'cash') {
      const received = cashReceivedValue > 0 ? cashReceivedValue : total
      return {
        amountPaid: Math.min(received, total),
        balanceDue: 0,
        changeReturn: Math.max(received - total, 0),
        paymentStatus: 'paid',
        paymentBreakdown: { cash: total, upi: 0, credit: 0 }
      }
    }

    if (paymentMethod === 'udhar') {
      return {
        amountPaid: 0,
        balanceDue: total,
        changeReturn: 0,
        paymentStatus: 'pending',
        paymentBreakdown: { cash: 0, upi: 0, credit: total }
      }
    }

    return {
      amountPaid: total,
      balanceDue: 0,
      changeReturn: 0,
      paymentStatus: 'paid',
      paymentBreakdown: { cash: 0, upi: total, credit: 0 }
    }
  }, [paymentMethod, total, splitCash, splitUpi, splitCredit, cashReceivedValue])

  const handleBarcodeSearch = async (e) => {
    if (e.key !== 'Enter' || !barcode.trim()) return

    try {
      const res = await api.get(`/products/barcode/${barcode.trim()}`)
      addToCart(res.data)
      setBarcode('')
    } catch (err) {
      showInfo('Alert', 'Product not found')
    }
  }

  const addToCart = (product) => {
    if (Number(product.stock) <= 0) {
      showInfo('Alert', 'Out of stock!')
      return
    }

    const defaultSource = getDefaultStockSource(product)
    const sourceStock = getAvailableStockForSource(product, defaultSource)
    if (sourceStock <= 0) {
      showInfo('Alert', `No ${defaultSource} stock available`)
      return
    }

    setCart((currentCart) => {
      const existing = currentCart.find((item) => item.product_id === product.id)

      if (existing) {
        if (existing.quantity >= existing.availableStock) {
          showInfo('Alert', 'Not enough stock!')
          return currentCart
        }

        return currentCart.map((item) =>
          item.product_id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      }

      return [
        {
          product_id: product.id,
          name: product.name,
          price: parseFloat(product.selling_price),
          originalPrice: parseFloat(product.selling_price),
          quantity: 1,
          stock: product.stock,
          availableStock: sourceStock,
          bank_stock: Number(product.bank_stock || 0),
          cash_stock: Number(product.cash_stock || 0),
          stock_source: defaultSource,
          unit: product.unit,
          barcode: product.barcode || '',
          manualPrice: false
        },
        ...currentCart
      ]
    })
  }

  const updateQuantity = (productId, nextQty) => {
    setCart((currentCart) => currentCart
      .map((item) => {
        if (item.product_id !== productId) return item

        const quantity = Math.floor(clampNumber(nextQty, item.quantity))
        if (quantity <= 0) return null
        if (quantity > item.availableStock) {
          showInfo('Alert', 'Not enough stock!')
          return item
        }
        return { ...item, quantity }
      })
      .filter(Boolean))
  }

  const updatePrice = (productId, nextPrice) => {
    setCart((currentCart) => currentCart.map((item) => {
      if (item.product_id !== productId) return item
      const parsedPrice = Math.max(clampNumber(nextPrice, item.price), 0)
      return {
        ...item,
        price: parsedPrice,
        manualPrice: parsedPrice !== Number(item.originalPrice)
      }
    }))
  }

  const updateStockSource = (productId, nextSource) => {
    setCart((currentCart) => currentCart.map((item) => {
      if (item.product_id !== productId) return item
      const availableStock = nextSource === 'cash' ? Number(item.cash_stock || 0) : Number(item.bank_stock || 0)
      if (availableStock <= 0) {
        showInfo('Alert', `No ${nextSource} stock available`)
        return item
      }
      return {
        ...item,
        stock_source: nextSource,
        availableStock,
        quantity: Math.min(item.quantity, availableStock)
      }
    }))
  }

  const removeFromCart = (productId) => {
    setCart((currentCart) => currentCart.filter((item) => item.product_id !== productId))
  }

  const resetBillingState = () => {
    setCart([])
    setSelectedCustomer('')
    setCustomerNameInput('')
    setPaymentMethod(shopSettings.default_payment_method || 'cash')
    setDiscount('0')
    setCashReceived('0')
    setSplitPayments({ cash: '', upi: '', credit: '' })
    setBillNotes('')
    setBarcode('')
  }

  const clearCart = () => {
    resetBillingState()
    localStorage.removeItem('posBillingDraft')
    barcodeRef.current?.focus()
  }

  const createBill = () => {
    if (cart.length === 0) {
      showInfo('Alert', 'Cart is empty!')
      return
    }
    setShowCheckoutModal(true)
  }

  const finalizeCreateBill = async () => {
    let finalCustomerId = selectedCustomer

    if (!finalCustomerId && customerNameInput.trim()) {
      const existingCustomer = customers.find((customer) => customer.name.toLowerCase() === customerNameInput.trim().toLowerCase())
      if (existingCustomer) {
        finalCustomerId = existingCustomer.id
      } else {
        const createdCustomer = await api.post('/customers', { name: customerNameInput.trim(), phone: '', address: '', customer_type: 'regular', gst_number: '' })
        finalCustomerId = createdCustomer.data.id
      }
    }

    if ((paymentMethod === 'udhar' || paymentMethod === 'split' || paymentSummary.balanceDue > 0) && !finalCustomerId) {
      showInfo('Alert', 'Enter customer name for credit or pending balance billing')
      return
    }

    if (paymentMethod === 'split' && splitTotal <= 0) {
      showInfo('Alert', 'Enter split payment values')
      return
    }

    if (paymentMethod === 'split' && Math.abs(splitTotal - total) > 0.01 && splitCredit <= 0) {
      showInfo('Alert', 'Split total should match bill total or include credit amount')
      return
    }

    try {
      setSubmitting(true)
      const res = await api.post('/sales', {
        customer_id: finalCustomerId || null,
        items: cart.map((item) => ({
          product_id: item.product_id,
          quantity: item.quantity,
          price: item.price,
          unit: item.unit,
          stock_source: item.stock_source,
          manual_price: item.manualPrice
        })),
        payment_method: paymentMethod,
        payment_status: paymentSummary.paymentStatus,
        payment_breakdown: paymentSummary.paymentBreakdown,
        amount_paid: paymentSummary.amountPaid,
        balance_due: paymentSummary.balanceDue,
        cash_received: paymentMethod === 'cash' ? (cashReceivedValue > 0 ? cashReceivedValue : total) : splitCash,
        change_return: paymentSummary.changeReturn,
        discount: discountValue,
        notes: billNotes
      })

      setLastBill(res.data)
      setShowCheckoutModal(false)
      setShowBill(true)
      resetBillingState()
      localStorage.removeItem('posBillingDraft')
      await loadData()
      barcodeRef.current?.focus()
    } catch (err) {
      showInfo('Alert', err.response?.data?.error || 'Failed to create bill')
    } finally {
      setSubmitting(false)
    }
  }

  const printBill = () => {
    window.print()
  }

  const buildBillText = (bill) => {
    let text = `*${shopSettings.shop_name || 'Shop'}*\n`
    text += `Bill: ${bill.bill_number}\n`
    text += `Date: ${new Date(bill.created_at).toLocaleString()}\n\n`

    ;(bill.items || []).forEach((item) => {
      text += `${item.product_name} x${item.quantity}${item.unit ? ` ${item.unit}` : ''} = ₹${item.total}\n`
    })

    if (Number(bill.discount) > 0) {
      text += `\nDiscount: ₹${Number(bill.discount).toFixed(2)}\n`
    }

    text += `\n*Total: ₹${Number(bill.total_amount).toFixed(2)}*\n`
    text += `Payment: ${String(bill.payment_method).toUpperCase()}\n`

    if (Number(bill.balance_due) > 0) {
      text += `Pending: ₹${Number(bill.balance_due).toFixed(2)}\n`
    }

    text += `\nThank you for shopping!`
    return text
  }

  const downloadPDF = (bill = lastBill) => {
    if (!bill) return

    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: [80, 220]
    })

    let y = 10

    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text(shopSettings.shop_name || 'Shop', 40, y, { align: 'center' })
    y += 6

    doc.setFontSize(8)
    doc.setFont('helvetica', 'normal')
    if (shopSettings.address) {
      doc.text(shopSettings.address, 40, y, { align: 'center' })
      y += 4
    }
    if (shopSettings.phone) {
      doc.text(`Ph: ${shopSettings.phone}`, 40, y, { align: 'center' })
      y += 4
    }

    y += 2
    doc.line(5, y, 75, y)
    y += 4
    doc.text(`Bill: ${bill.bill_number}`, 5, y)
    y += 4
    doc.text(`Date: ${new Date(bill.created_at).toLocaleString()}`, 5, y)
    y += 4
    doc.text(`Customer: ${bill.customer_name || 'Walk-in'}`, 5, y)
    y += 4
    doc.text(`Cashier: ${bill.cashier_name || user.name}`, 5, y)
    y += 4
    doc.line(5, y, 75, y)
    y += 4

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.text('Item', 5, y)
    doc.text('Qty', 38, y)
    doc.text('Rate', 50, y)
    doc.text('Amt', 66, y)
    y += 4
    doc.setFont('helvetica', 'normal')

    ;(bill.items || []).forEach((item) => {
      const name = item.product_name.length > 16 ? `${item.product_name.slice(0, 16)}...` : item.product_name
      doc.text(name, 5, y)
      doc.text(`${item.quantity}${item.unit ? ` ${String(item.unit).slice(0, 3)}` : ''}`, 38, y)
      doc.text(String(item.price), 50, y)
      doc.text(String(item.total), 66, y)
      y += 4
    })

    y += 1
    doc.line(5, y, 75, y)
    y += 5
    doc.text(`Subtotal: ₹${Number(bill.subtotal || 0).toFixed(2)}`, 5, y)
    y += 4
    if (Number(bill.discount || 0) > 0) {
      doc.text(`Discount: ₹${Number(bill.discount).toFixed(2)}`, 5, y)
      y += 4
    }
    doc.setFont('helvetica', 'bold')
    doc.text(`Total: ₹${Number(bill.total_amount || 0).toFixed(2)}`, 5, y)
    y += 5
    doc.text(`Payment: ${String(bill.payment_method).toUpperCase()}`, 5, y)
    y += 4
    if (Number(bill.amount_paid || 0) > 0) {
      doc.text(`Paid: ₹${Number(bill.amount_paid).toFixed(2)}`, 5, y)
      y += 4
    }
    if (Number(bill.balance_due || 0) > 0) {
      doc.text(`Pending: ₹${Number(bill.balance_due).toFixed(2)}`, 5, y)
      y += 4
    }
    if (Number(bill.change_return || 0) > 0) {
      doc.text(`Change: ₹${Number(bill.change_return).toFixed(2)}`, 5, y)
      y += 4
    }

    doc.setFont('helvetica', 'normal')
    doc.line(5, y, 75, y)
    y += 4
    doc.text(shopSettings.bill_footer || 'Thank you for shopping!', 40, y, { align: 'center' })
    doc.save(`${bill.bill_number}.pdf`)
  }

  const shareBillWhatsApp = (bill = lastBill) => {
    if (!bill) return

    const text = buildBillText(bill)
    const phone = bill.customer_phone?.replace(/\D/g, '') || ''
    const url = phone
      ? `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`
      : `https://wa.me/?text=${encodeURIComponent(text)}`

    window.open(url, '_blank')
  }

  const loadSaleDetails = async (saleId) => {
    const res = await api.get(`/sales/${saleId}`)
    setLastBill(res.data)
    setShowBill(true)
  }

  const filteredProducts = useMemo(() => products.filter((product) =>
    product.name.toLowerCase().includes(search.toLowerCase()) ||
    product.barcode?.includes(search)
  ), [products, search])

  if (loading) {
    return <div className="loading">Loading...</div>
  }

  return (
    <div className="pos-container pos-container-enterprise">
      <div className="products-section">
        <div className="search-bar pos-toolbar">
          <input
            ref={searchRef}
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <input
            ref={barcodeRef}
            type="text"
            placeholder="Barcode scan..."
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={handleBarcodeSearch}
            style={{ width: '220px' }}
          />
        </div>

        <div className="products-grid">
          {filteredProducts.map((product) => (
            <div
              key={product.id}
              className={`product-card ${product.stock <= 0 ? 'out-of-stock' : ''}`}
              onClick={() => addToCart(product)}
            >
              <div className="product-card-head">
                <h4>{product.name}</h4>
                <span className="product-unit-tag">{product.unit || 'Unit'}</span>
              </div>
              <div className="product-price">₹{product.selling_price}</div>
              <div className={`product-stock ${product.stock <= product.min_stock ? 'low' : ''}`}>
                Total: {product.stock}
              </div>
              <div className="product-meta">Bank {product.bank_stock || 0} | Cash {product.cash_stock || 0}</div>
            </div>
          ))}

          {filteredProducts.length === 0 && (
            <div className="empty-state">No products found</div>
          )}
        </div>
      </div>

      <div className="cart-section enterprise-cart">
        <div className="cart-header">
          <div>
            <h2>Billing</h2>
          </div>
          <button className="btn btn-danger" style={{ width: '88px', padding: '0.8rem 1rem' }} onClick={clearCart}>Clear</button>
        </div>

        <div className="customer-select customer-panel">
          <label>Select Customer</label>
          <select
            value={selectedCustomer}
            onChange={(e) => {
              const value = e.target.value
              setSelectedCustomer(value)
              const matched = customers.find((customer) => String(customer.id) === String(value))
              setCustomerNameInput(matched?.name || '')
            }}
          >
            <option value="">Select Customer</option>
            {customers.map((customer, index) => (
              <option key={customer.id} value={customer.id}>
                {index + 1}. {customer.name} - {customer.phone || 'No phone'}
              </option>
            ))}
          </select>


        </div>

        <div className="cart-items enterprise-cart-items">
          {cart.map((item) => (
            <div key={item.product_id} className="cart-item enterprise-cart-item">
              <div className="cart-item-main">
                <div style={{ flex: 1 }}>
                  <div className="cart-item-name">{item.name}</div>
                  <div className="cart-item-price">₹{item.price} {item.unit ? `/${item.unit}` : ''}</div>
                  <div className="cart-item-meta">Source: {item.stock_source === 'bank' ? 'Bank Stock' : 'Cash Stock'} | Available {item.availableStock}</div>
                </div>
                <button className="remove-btn" onClick={() => removeFromCart(item.product_id)}>✕</button>
              </div>

              <div className="cart-edit-grid">
                <div className="quick-edit-block">
                  <span>Qty</span>
                  <div className="cart-item-controls">
                    <button className="qty-btn" onClick={() => updateQuantity(item.product_id, item.quantity - 1)}>-</button>
                    <input
                      className="qty-input"
                      type="number"
                      min="1"
                      max={item.availableStock}
                      value={item.quantity}
                      onChange={(e) => updateQuantity(item.product_id, e.target.value)}
                    />
                    <button className="qty-btn" onClick={() => updateQuantity(item.product_id, item.quantity + 1)}>+</button>
                  </div>
                </div>

                <div className="quick-edit-block">
                  <span>Stock Source</span>
                  <select className="qty-input" value={item.stock_source} onChange={(e) => updateStockSource(item.product_id, e.target.value)}>
                    <option value="bank">Bank Stock</option>
                    <option value="cash">Cash Stock</option>
                  </select>
                </div>

                <div className="line-total-block">
                  <span>Total</span>
                  <strong>{formatCurrency(item.quantity * item.price)}</strong>
                </div>
              </div>
            </div>
          ))}

          {cart.length === 0 && (
            <div className="empty-state">Cart is empty</div>
          )}
        </div>

        <div className="cart-total enterprise-total">
          <div className="total-row">
            <span>Items</span>
            <span>{cart.reduce((sum, item) => sum + item.quantity, 0)}</span>
          </div>
          <div className="total-row">
            <span>Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          <div className="total-row grand-total">
            <span>Total</span>
            <span>{formatCurrency(total)}</span>
          </div>
          {paymentSummary.balanceDue > 0 && (
            <div className="total-row warning-total">
              <span>Pending Due</span>
              <span>{formatCurrency(paymentSummary.balanceDue)}</span>
            </div>
          )}
          {paymentSummary.changeReturn > 0 && (
            <div className="total-row success-total">
              <span>Change Return</span>
              <span>{formatCurrency(paymentSummary.changeReturn)}</span>
            </div>
          )}
        </div>

        <button className="btn btn-primary create-bill-btn" onClick={createBill} disabled={submitting}>
          {submitting ? 'Saving...' : 'Create Bill'}
        </button>
      </div>

      {showCheckoutModal && (
        <div className="modal-overlay" onClick={() => setShowCheckoutModal(false)}>
          <div className="modal" style={{ maxWidth: '560px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Finalize Bill</h2>
              <button className="modal-close" onClick={() => setShowCheckoutModal(false)}>×</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Customer Name</label>
                <input
                  type="text"
                  value={customerNameInput}
                  onChange={(e) => setCustomerNameInput(e.target.value)}
                  placeholder="Enter customer name"
                  list="billing-customer-list"
                />
                <datalist id="billing-customer-list">
                  {customers.map((customer) => (
                    <option key={customer.id} value={customer.name} />
                  ))}
                </datalist>
              </div>
              {canOverridePrice && <div className="form-group">
                <label>Discount</label>
                <input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" />
              </div>}
              <div className="form-group">
                <label>Payment Method</label>
                <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="udhar">Credit</option>
                  <option value="split">Split</option>
                </select>
              </div>
              {paymentMethod === 'cash' && (
                <div className="form-group">
                  <label>Cash Received</label>
                  <input type="number" min="0" step="0.01" value={cashReceived} onChange={(e) => setCashReceived(e.target.value)} placeholder={`Default ${total.toFixed(2)}`} />
                </div>
              )}
              {paymentMethod === 'split' && (
                <div className="split-payment-grid" style={{ marginBottom: '1rem' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}><label>Cash</label><input type="number" min="0" step="0.01" value={splitPayments.cash} onChange={(e) => setSplitPayments((prev) => ({ ...prev, cash: e.target.value }))} /></div>
                  <div className="form-group" style={{ marginBottom: 0 }}><label>UPI</label><input type="number" min="0" step="0.01" value={splitPayments.upi} onChange={(e) => setSplitPayments((prev) => ({ ...prev, upi: e.target.value }))} /></div>
                  <div className="form-group" style={{ marginBottom: 0 }}><label>Credit</label><input type="number" min="0" step="0.01" value={Math.max(total - (clampNumber(splitPayments.cash) + clampNumber(splitPayments.upi)), 0).toFixed(2)} readOnly /></div>
                </div>
              )}
              <div className="form-group">
                <label>Notes</label>
                <input type="text" value={billNotes} onChange={(e) => setBillNotes(e.target.value)} placeholder="Optional notes" />
              </div>
              <div className="cart-total" style={{ marginBottom: 0 }}>
                <div className="total-row"><span>Items</span><span>{cart.reduce((sum, item) => sum + item.quantity, 0)}</span></div>
                <div className="total-row"><span>Subtotal</span><span>{formatCurrency(subtotal)}</span></div>
                <div className="total-row"><span>Discount</span><span>{formatCurrency(discountValue)}</span></div>
                <div className="total-row grand-total"><span>Total</span><span>{formatCurrency(total)}</span></div>
                {paymentSummary.balanceDue > 0 && <div className="total-row warning-total"><span>Pending Due</span><span>{formatCurrency(paymentSummary.balanceDue)}</span></div>}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCheckoutModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={finalizeCreateBill} disabled={submitting}>{submitting ? 'Saving...' : 'Final Create Bill'}</button>
            </div>
          </div>
        </div>
      )}

      {showBill && lastBill && (
        <div className="modal-overlay" onClick={() => setShowBill(false)}>
          <div className="modal bill-modal" onClick={(e) => e.stopPropagation()}>
            <div className="bill-content">
              <div className="bill-header">
                <h2>{shopSettings.shop_name || 'Shop'}</h2>
                <p>{shopSettings.address}</p>
                <p>{shopSettings.phone}</p>
              </div>

              <div className="bill-info">
                <p><strong>Bill:</strong> {lastBill.bill_number}</p>
                <p><strong>Date:</strong> {new Date(lastBill.created_at).toLocaleString()}</p>
                <p><strong>Customer:</strong> {lastBill.customer_name || 'Walk-in'}</p>
                <p><strong>Cashier:</strong> {lastBill.cashier_name || user.name}</p>
                {lastBill.notes && <p><strong>Note:</strong> {lastBill.notes}</p>}
              </div>

              <div className="bill-items">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Price</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(lastBill.items || []).map((item, index) => (
                      <tr key={index}>
                        <td>{item.product_name}{item.unit ? ` (${item.unit})` : ''}</td>
                        <td>{item.quantity}</td>
                        <td>₹{item.price}</td>
                        <td>₹{item.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bill-total">
                <p>Subtotal: ₹{Number(lastBill.subtotal || 0).toFixed(2)}</p>
                {Number(lastBill.discount || 0) > 0 && <p>Discount: ₹{Number(lastBill.discount).toFixed(2)}</p>}
                <p>Payment: {String(lastBill.payment_method).toUpperCase()}</p>
                {Number(lastBill.amount_paid || 0) > 0 && <p>Paid: ₹{Number(lastBill.amount_paid).toFixed(2)}</p>}
                {Number(lastBill.balance_due || 0) > 0 && <p>Pending: ₹{Number(lastBill.balance_due).toFixed(2)}</p>}
                {Number(lastBill.change_return || 0) > 0 && <p>Change: ₹{Number(lastBill.change_return).toFixed(2)}</p>}
                <p style={{ fontSize: '1.25rem' }}>Total: ₹{Number(lastBill.total_amount || 0).toFixed(2)}</p>
              </div>

              <div className="bill-footer">
                <p>{shopSettings.bill_footer || 'Thank you for shopping!'}</p>
              </div>
            </div>

            <div className="bill-actions">
              <button className="btn btn-secondary" onClick={printBill}>Print</button>
              <button className="btn btn-warning" onClick={() => downloadPDF(lastBill)}>PDF</button>
              <button className="btn btn-primary" onClick={() => shareBillWhatsApp(lastBill)}>WhatsApp</button>
              <button className="btn btn-danger" onClick={() => setShowBill(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      <InfoModal
        isOpen={infoModal.isOpen}
        title={infoModal.title || 'Alert'}
        message={infoModal.message}
        onClose={() => setInfoModal({ isOpen: false, title: '', message: '' })}
      />
    </div>
  )
}

export default POS

