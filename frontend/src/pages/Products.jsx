import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import api from '../services/api'
import ConfirmModal from '../components/ConfirmModal'
import InfoModal from '../components/InfoModal'

const CATEGORY_TABS = ['All', 'Pulses', 'Rice', 'Oil Tin', 'Oil Ltr', 'Flour', 'Sugar']
const UNIT_OPTIONS = ['Kg', 'Ltr', 'Pcs', 'Tin (15kg)', 'Bori (50kg)']
const CATEGORY_LABEL_MAP = {
  'Pulses': 'Dal',
  'Oil Tin': 'Oil',
  'Oil Ltr': 'Oil',
  'Rice': 'Rice',
  'Flour': 'Atta',
  'Sugar': 'Sugar'
}

function Products({ user }) {
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [shopSettings, setShopSettings] = useState({})
  const [showModal, setShowModal] = useState(false)
  const [editProduct, setEditProduct] = useState(null)
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('All')
  const [bulkSearch, setBulkSearch] = useState('')
  const [bulkSelectedCategory, setBulkSelectedCategory] = useState('All')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [bulkEdits, setBulkEdits] = useState({})
  const [savingBulk, setSavingBulk] = useState(false)
  const [showBulkEditor, setShowBulkEditor] = useState(false)
  const [bulkMinimized, setBulkMinimized] = useState(false)
  const [infoModal, setInfoModal] = useState({ isOpen: false, title: '', message: '' })
  const [form, setForm] = useState({
    name: '',
    category_id: '',
    brand: '',
    barcode: '',
    purchase_price: '',
    selling_price: '',
    bank_stock: '',
    cash_stock: '',
    min_stock: '10',
    unit: 'Kg'
  })

  useEffect(() => {
    loadData()
  }, [])

  const showInfo = (title, message) => {
    setInfoModal({ isOpen: true, title, message })
  }

  const loadData = async () => {
    try {
      const [productsRes, categoriesRes, settingsRes] = await Promise.all([
        api.get('/products'),
        api.get('/products/categories'),
        api.get('/settings')
      ])
      setProducts(productsRes.data)
      setCategories(categoriesRes.data)
      setShopSettings(settingsRes.data)
      setBulkEdits({})
    } catch (err) {
      console.error('Load error:', err)
    }
  }

  const openModal = (product = null) => {
    if (product) {
      setEditProduct(product)
      setForm({
        name: product.name,
        category_id: product.category_name === 'Oil'
          ? `${product.category_id}:${String(product.unit).includes('Tin') ? 'tin' : 'ltr'}`
          : product.category_id || '',
        brand: product.brand || '',
        barcode: product.barcode || '',
        purchase_price: product.purchase_price,
        selling_price: product.selling_price,
        bank_stock: product.bank_stock ?? product.stock,
        cash_stock: product.cash_stock ?? 0,
        min_stock: product.min_stock,
        unit: product.unit || 'Kg'
      })
    } else {
      setEditProduct(null)
      const generalCategory = categories.find(c => c.name === 'General')
      setForm({
        name: '',
        category_id: generalCategory?.id || '',
        brand: '',
        barcode: '',
        purchase_price: '',
        selling_price: '',
        bank_stock: '',
        cash_stock: '',
        min_stock: '10',
        unit: 'Kg'
      })
    }
    setShowModal(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const normalizedCategoryId = String(form.category_id).split(':')[0]
      const payload = {
        ...form,
        category_id: normalizedCategoryId,
        purchase_price: Number(form.purchase_price),
        selling_price: Number(form.selling_price),
        bank_stock: Number(form.bank_stock || 0),
        cash_stock: Number(form.cash_stock || 0),
        min_stock: Number(form.min_stock || 10)
      }

      if (editProduct) {
        await api.put(`/products/${editProduct.id}`, payload)
      } else {
        await api.post('/products', payload)
      }
      setShowModal(false)
      loadData()
    } catch (err) {
      showInfo('Error', err.response?.data?.error || 'Failed to save product')
    }
  }

  const confirmDelete = (product) => {
    setDeleteTarget(product)
    setShowDeleteConfirm(true)
  }

  const deleteProduct = async () => {
    if (!deleteTarget) return
    try {
      await api.delete(`/products/${deleteTarget.id}`)
      setShowDeleteConfirm(false)
      setDeleteTarget(null)
      loadData()
    } catch (err) {
      showInfo('Error', err.response?.data?.error || 'Failed to delete product')
    }
  }

  const downloadStockPDF = () => {
    const doc = new jsPDF()
    let y = 20
    const reportProducts = filteredProducts

    doc.setFontSize(18)
    doc.setFont('helvetica', 'bold')
    doc.text(shopSettings.shop_name || 'Shop', 105, y, { align: 'center' })
    y += 8

    doc.setFontSize(14)
    doc.text('Stock / Inventory Report', 105, y, { align: 'center' })
    y += 6

    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(`Category: ${selectedCategory}`, 20, y)
    doc.text(`Generated: ${new Date().toLocaleString()}`, 190, y, { align: 'right' })
    y += 10

    const totalProducts = reportProducts.length
    const totalStock = reportProducts.reduce((sum, p) => sum + parseInt(p.stock || 0), 0)
    const stockValue = reportProducts.reduce((sum, p) => sum + (parseFloat(p.purchase_price || 0) * parseInt(p.stock || 0)), 0)
    const lowStockCount = reportProducts.filter(p => parseInt(p.stock || 0) <= parseInt(p.min_stock || 0)).length

    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text('Summary', 20, y)
    y += 6
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(`Products: ${totalProducts}`, 20, y)
    doc.text(`Units in Stock: ${totalStock}`, 80, y)
    doc.text(`Low Stock: ${lowStockCount}`, 150, y)
    y += 5
    doc.text(`Stock Value: Rs.${stockValue.toFixed(2)}`, 20, y)
    y += 8

    doc.line(20, y, 190, y)
    y += 8

    doc.setFontSize(9)
    doc.setFont('helvetica', 'bold')
    doc.text('Product', 20, y)
    doc.text('Category', 78, y)
    doc.text('Unit', 110, y)
    doc.text('Stock', 128, y)
    doc.text('Purchase', 150, y)
    doc.text('Selling', 172, y)
    y += 6

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)

    reportProducts.forEach(product => {
      if (y > 270) {
        doc.addPage()
        y = 20
      }

      const isLowStock = Number(product.stock) <= Number(product.min_stock)
      doc.text(String(product.name).substring(0, 28), 20, y)
      doc.text(String(product.category_name || '-').substring(0, 15), 78, y)
      doc.text(String(product.unit || '-').substring(0, 10), 110, y)
      if (isLowStock) doc.setTextColor(255, 0, 0)
      doc.text(String(product.stock), 128, y)
      doc.setTextColor(0, 0, 0)
      doc.text(`Rs.${product.purchase_price}`, 150, y)
      doc.text(`Rs.${product.selling_price}`, 172, y)
      y += 5
    })

    const totalPurchasePrice = reportProducts.reduce((sum, p) => sum + Number(p.purchase_price || 0), 0)
    const totalSellingPrice = reportProducts.reduce((sum, p) => sum + Number(p.selling_price || 0), 0)

    y += 6
    if (y > 245) {
      doc.addPage()
      y = 20
    }

    doc.line(20, y, 190, y)
    y += 8
    doc.setFontSize(11)
    doc.setFont('helvetica', 'bold')
    doc.text('Closing Summary', 20, y)
    y += 8

    doc.setFontSize(10)
    doc.setFont('helvetica', 'normal')
    doc.text(`Total Products: ${totalProducts}`, 20, y)
    doc.text(`Total Stock Qty: ${totalStock}`, 105, y)
    y += 6
    doc.text(`Total Stock Amount: Rs.${stockValue.toFixed(2)}`, 20, y)
    doc.text(`Total Purchase Price: Rs.${totalPurchasePrice.toFixed(2)}`, 105, y)
    y += 6
    doc.text(`Total Selling Price: Rs.${totalSellingPrice.toFixed(2)}`, 20, y)
    y += 6
    doc.line(20, y, 190, y)

    doc.save(`Stock_Report_${selectedCategory}_${new Date().toISOString().split('T')[0]}.pdf`)
  }

  const handleBulkEditChange = (productId, field, value, fallbackValue) => {
    setShowBulkEditor(true)
    setBulkMinimized(false)
    setBulkEdits(prev => ({
      ...prev,
      [productId]: {
        purchase_price: prev[productId]?.purchase_price ?? fallbackValue.purchase_price,
        selling_price: prev[productId]?.selling_price ?? fallbackValue.selling_price,
        [field]: value
      }
    }))
  }

  const saveBulkPrices = async () => {
    const updates = Object.entries(bulkEdits)
      .map(([id, values]) => ({
        id: Number(id),
        purchase_price: Number(values.purchase_price),
        selling_price: Number(values.selling_price)
      }))
      .filter(item => !Number.isNaN(item.purchase_price) && !Number.isNaN(item.selling_price))

    if (updates.length === 0) {
      showInfo('Bulk Price Update', 'No bulk price changes to save')
      return
    }

    try {
      setSavingBulk(true)
      await api.put('/products/bulk-price-update', { updates })
      setBulkEdits({})
      setShowBulkEditor(false)
      setBulkMinimized(false)
      showInfo('Success', `Updated ${updates.length} products successfully`)
      await loadData()
    } catch (err) {
      showInfo('Error', err.response?.data?.error || 'Failed to update prices')
    } finally {
      setSavingBulk(false)
    }
  }

  const matchesCategoryFilter = (product, categoryFilter) => {
    if (categoryFilter === 'All') return true
    if (categoryFilter === 'Oil Tin') return product.category_name === 'Oil' && String(product.unit).includes('Tin')
    if (categoryFilter === 'Oil Ltr') return product.category_name === 'Oil' && String(product.unit).includes('Ltr')
    return product.category_name === CATEGORY_LABEL_MAP[categoryFilter]
  }

  const matchesSearchFilter = (product, searchTerm) => {
    const term = searchTerm.toLowerCase()
    return (
      product.name.toLowerCase().includes(term) ||
      (product.barcode || '').includes(searchTerm) ||
      (product.brand || '').toLowerCase().includes(term)
    )
  }

  const filteredProducts = useMemo(() => {
    return products.filter(product => matchesCategoryFilter(product, selectedCategory) && matchesSearchFilter(product, search))
  }, [products, search, selectedCategory])

  const filteredBulkProducts = useMemo(() => {
    return products.filter(product => matchesCategoryFilter(product, bulkSelectedCategory) && matchesSearchFilter(product, bulkSearch))
  }, [products, bulkSearch, bulkSelectedCategory])

  const productSummary = useMemo(() => ({
    totalItems: filteredProducts.length,
    totalStock: filteredProducts.reduce((sum, item) => sum + Number(item.stock || 0), 0),
    lowStock: filteredProducts.filter(item => Number(item.stock || 0) <= Number(item.min_stock || 0)).length,
    stockValue: filteredProducts.reduce((sum, item) => sum + (Number(item.stock || 0) * Number(item.purchase_price || 0)), 0)
  }), [filteredProducts])

  const canEdit = user.role === 'admin' || user.role === 'manager'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 3rem)', overflow: 'hidden' }}>
      <div className="page-header">
        <div>
          <h1>Products</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
            Wholesale inventory for daily commodity pricing and unit-based stock control.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {canEdit && <button className="btn btn-warning" onClick={downloadStockPDF}>Stock PDF</button>}
          {canEdit && (
            <button className="btn btn-secondary" style={{ width: 'auto' }} onClick={() => {
              setShowBulkEditor(true)
              setBulkMinimized(false)
              setBulkSelectedCategory('All')
              setBulkSearch('')
            }}>
              Bulk Price Update
            </button>
          )}
          {canEdit && (
            <button className="btn btn-primary" style={{ width: 'auto' }} onClick={() => openModal()}>
              Add Product
            </button>
          )}
        </div>
      </div>

      <div className="category-pills">
        {CATEGORY_TABS.map(category => (
          <button
            key={category}
            type="button"
            className={`category-pill ${selectedCategory === category ? 'active' : ''}`}
            onClick={() => setSelectedCategory(category)}
          >
            {category}
          </button>
        ))}
      </div>

      <div className="products-toolbar">
        <div className="search-bar products-search-bar" style={{ marginBottom: 0 }}>
          <input
            type="text"
            placeholder="Search by product, brand or barcode..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="stats-grid" style={{ marginTop: '1rem' }}>
        <div className="stat-card">
          <h3>Total Products</h3>
          <div className="value">{productSummary.totalItems}</div>
        </div>
        <div className="stat-card">
          <h3>Total Stock Units</h3>
          <div className="value">{productSummary.totalStock}</div>
        </div>
        <div className="stat-card">
          <h3>Low Stock Items</h3>
          <div className="value">{productSummary.lowStock}</div>
        </div>
        <div className="stat-card">
          <h3>Stock Value</h3>
          <div className="value">₹{productSummary.stockValue.toFixed(2)}</div>
        </div>
      </div>


      <div className="data-table products-table-scroll" style={{ marginTop: '1rem', height: '520px', flex: '0 0 auto' }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Unit</th>
              <th>Barcode</th>
              <th>Purchase</th>
              <th>Selling</th>
              <th>Bank Stock</th>
              <th>Cash Stock</th>
              <th>Total</th>
              {canEdit && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {filteredProducts.map(product => (
              <tr key={product.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{product.name}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{product.brand || 'Wholesale item'}</div>
                </td>
                <td>{product.category_name || 'General'}</td>
                <td>{product.unit || '-'}</td>
                <td>{product.barcode || '-'}</td>
                <td>₹{Number(product.purchase_price).toFixed(2)}</td>
                <td>₹{Number(product.selling_price).toFixed(2)}</td>
                <td>{product.bank_stock || 0} {product.unit}</td>
                <td>{product.cash_stock || 0} {product.unit}</td>
                <td>
                  <span className={`stock-badge ${Number(product.stock) <= Number(product.min_stock) ? 'low' : ''}`}>
                    {product.stock} {product.unit}
                  </span>
                </td>
                {canEdit && (
                  <td>
                    <div className="action-buttons">
                      <button className="btn btn-sm btn-secondary" onClick={() => openModal(product)}>Edit</button>
                      {user.role === 'admin' && (
                        <button className="btn btn-sm btn-danger" onClick={() => confirmDelete(product)}>Delete</button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
            {filteredProducts.length === 0 && (
              <tr>
                <td colSpan={canEdit ? 10 : 9} className="empty-state">No products found for this category/search.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canEdit && showBulkEditor && !bulkMinimized && (
        <div className="modal-overlay" onClick={() => setShowBulkEditor(false)}>
          <div className="modal" style={{ maxWidth: '980px' }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Bulk Price Update</h2>
              <button className="modal-close" onClick={() => setShowBulkEditor(false)}>×</button>
            </div>

            <div className="modal-body" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                Update purchase and selling prices in bulk. You can minimize and continue other work.
              </p>

              <div className="category-pills" style={{ marginBottom: '0.75rem' }}>
                {CATEGORY_TABS.map(category => (
                  <button
                    key={`bulk-${category}`}
                    type="button"
                    className={`category-pill ${bulkSelectedCategory === category ? 'active' : ''}`}
                    onClick={() => setBulkSelectedCategory(category)}
                  >
                    {category}
                  </button>
                ))}
              </div>

              <div className="search-bar products-search-bar" style={{ marginBottom: '0.9rem' }}>
                <input
                  type="text"
                  placeholder="Search product for bulk update..."
                  value={bulkSearch}
                  onChange={(e) => setBulkSearch(e.target.value)}
                />
              </div>

              <div className="bulk-price-grid">
                {filteredBulkProducts.map(product => {
                  const values = bulkEdits[product.id] || {
                    purchase_price: product.purchase_price,
                    selling_price: product.selling_price
                  }

                  return (
                    <div key={product.id} className="bulk-price-row">
                      <div>
                        <div className="bulk-product-name">{product.name}</div>
                        <div className="bulk-product-meta">{product.category_name || 'General'} • {product.unit || '-'}</div>
                      </div>
                      <input
                        type="number"
                        step="0.01"
                        value={values.purchase_price}
                        onChange={(e) => handleBulkEditChange(product.id, 'purchase_price', e.target.value, {
                          purchase_price: product.purchase_price,
                          selling_price: product.selling_price
                        })}
                      />
                      <input
                        type="number"
                        step="0.01"
                        value={values.selling_price}
                        onChange={(e) => handleBulkEditChange(product.id, 'selling_price', e.target.value, {
                          purchase_price: product.purchase_price,
                          selling_price: product.selling_price
                        })}
                      />
                    </div>
                  )
                })}
              </div>

              {filteredBulkProducts.length === 0 && (
                <p style={{ marginTop: '0.75rem', color: 'var(--text-secondary)' }}>
                  No products found for this category/search.
                </p>
              )}
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setBulkMinimized(true)}>
                Minimize
              </button>
              <button type="button" className="btn btn-primary" onClick={saveBulkPrices} disabled={savingBulk}>
                {savingBulk ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {canEdit && showBulkEditor && bulkMinimized && (
        <div style={{ position: 'fixed', right: '20px', bottom: '20px', zIndex: 1100, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '12px', padding: '0.9rem', boxShadow: 'var(--shadow)', minWidth: '260px' }}>
          <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>Bulk Price Update</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.6rem' }}>Minimized • continue your work</div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary btn-sm" onClick={() => setBulkMinimized(false)}>Open</button>
            <button className="btn btn-primary btn-sm" onClick={saveBulkPrices} disabled={savingBulk}>{savingBulk ? 'Saving...' : 'Save'}</button>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={showDeleteConfirm}
        title="Delete Product"
        message={`Are you sure you want to delete "${deleteTarget?.name}"?`}
        confirmText="Yes, Delete"
        cancelText="Cancel"
        type="danger"
        onConfirm={deleteProduct}
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
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editProduct ? 'Edit Product' : 'Add Product'}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>×</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Product Name *</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Category *</label>
                    <select
                      value={form.category_id}
                      onChange={(e) => {
                        const value = e.target.value
                        let nextUnit = form.unit
                        if (value.endsWith(':tin')) nextUnit = 'Tin (15kg)'
                        if (value.endsWith(':ltr')) nextUnit = 'Ltr'
                        setForm({ ...form, category_id: value, unit: nextUnit })
                      }}
                      required
                    >
                      <option value="">Select Category</option>
                      {categories
                        .filter(c => ['Dal', 'Rice', 'Oil', 'Atta', 'Sugar'].includes(c.name))
                        .flatMap(c => {
                          if (c.name === 'Oil') {
                            return [
                              <option key={`${c.id}-tin`} value={`${c.id}:tin`}>Oil Tin</option>,
                              <option key={`${c.id}-ltr`} value={`${c.id}:ltr`}>Oil Ltr</option>
                            ]
                          }

                          const label = c.name === 'Dal' ? 'Pulses' : c.name === 'Atta' ? 'Flour' : c.name
                          return <option key={c.id} value={String(c.id)}>{label}</option>
                        })}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Unit *</label>
                    <select
                      value={form.unit}
                      onChange={(e) => setForm({ ...form, unit: e.target.value })}
                      required
                    >
                      {UNIT_OPTIONS.map(unit => (
                        <option key={unit} value={unit}>{unit}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Brand</label>
                    <input
                      type="text"
                      value={form.brand}
                      onChange={(e) => setForm({ ...form, brand: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label>Barcode</label>
                    <input
                      type="text"
                      value={form.barcode}
                      onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Purchase Price *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.purchase_price}
                      onChange={(e) => setForm({ ...form, purchase_price: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Selling Price *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={form.selling_price}
                      onChange={(e) => setForm({ ...form, selling_price: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Bank Stock *</label>
                    <input
                      type="number"
                      value={form.bank_stock}
                      onChange={(e) => setForm({ ...form, bank_stock: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Cash Stock *</label>
                    <input
                      type="number"
                      value={form.cash_stock}
                      onChange={(e) => setForm({ ...form, cash_stock: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Low Stock Alert</label>
                    <input
                      type="number"
                      value={form.min_stock}
                      onChange={(e) => setForm({ ...form, min_stock: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Save Product</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Products
