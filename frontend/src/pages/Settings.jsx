import { useEffect, useState } from 'react'
import api from '../services/api'
import InfoModal from '../components/InfoModal'
import ConfirmModal from '../components/ConfirmModal'

const formatAuditDetails = (details) => {
  if (!details) return '-'
  if (typeof details === 'object') return JSON.stringify(details, null, 2)
  try {
    const value = JSON.parse(details)
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  } catch {
    return details
  }
}

function Settings({ user }) {
  const settingsFields = ['shop_name', 'address', 'phone', 'email', 'gst_number', 'bill_prefix', 'logo_url', 'bill_footer', 'thank_you_note', 'gst_enabled', 'tax_percent', 'financial_year_start', 'low_stock_threshold', 'printer_type', 'invoice_format', 'print_preview', 'default_payment_method', 'default_customer_label', 'default_report_period', 'session_timeout_minutes', 'theme']
  const defaultSettings = {
    shop_name: '',
    address: '',
    phone: '',
    email: '',
    gst_number: '',
    bill_prefix: '',
    logo_url: '',
    bill_footer: '',
    thank_you_note: '',
    gst_enabled: true,
    tax_percent: 0,
    financial_year_start: '04-01',
    low_stock_threshold: 10,
    printer_type: '80mm',
    invoice_format: 'thermal',
    print_preview: true,
    default_payment_method: 'cash',
    default_customer_label: 'Walk-in Customer',
    default_report_period: 'month',
    session_timeout_minutes: 60
  }

  const [settings, setSettings] = useState(defaultSettings)
  const [users, setUsers] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [auditUsers, setAuditUsers] = useState([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [showUserManagement, setShowUserManagement] = useState(false)
  const [showAuditModal, setShowAuditModal] = useState(false)
  const [auditFilters, setAuditFilters] = useState({ q: '', userId: '', action: '', from: '', to: '' })
  const [auditPagination, setAuditPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 0 })
  const [showUserModal, setShowUserModal] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [showProfileModal, setShowProfileModal] = useState(false)
  const [showInvoiceModal, setShowInvoiceModal] = useState(false)
  const [showInvoicePreview, setShowInvoicePreview] = useState(false)
  const [backupCheck, setBackupCheck] = useState(null)
  const [backupChecking, setBackupChecking] = useState(false)
  const [showTaxModal, setShowTaxModal] = useState(false)
  const [userForm, setUserForm] = useState({ name: '', email: '', password: '', role: 'cashier', is_active: true })
  const [passwordReset, setPasswordReset] = useState({ open: false, user: null, password: '' })
  const [infoModal, setInfoModal] = useState({ isOpen: false, title: '', message: '' })
  const [confirmState, setConfirmState] = useState({ isOpen: false, user: null, nextState: false })
  const [deleteState, setDeleteState] = useState({ isOpen: false, user: null })

  useEffect(() => { loadSettings() }, [])

  useEffect(() => {
    const modalIsOpen = showProfileModal || showInvoiceModal || showInvoicePreview || showTaxModal || showUserManagement || showAuditModal || showUserModal || passwordReset.open || confirmState.isOpen || deleteState.isOpen || infoModal.isOpen
    if (!modalIsOpen) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return
      if (infoModal.isOpen) setInfoModal({ isOpen: false, title: '', message: '' })
      else if (confirmState.isOpen) setConfirmState({ isOpen: false, user: null, nextState: false })
      else if (deleteState.isOpen) setDeleteState({ isOpen: false, user: null })
      else if (passwordReset.open) setPasswordReset({ open: false, user: null, password: '' })
      else if (showUserModal) setShowUserModal(false)
      else if (showInvoicePreview) setShowInvoicePreview(false)
      else if (showAuditModal) setShowAuditModal(false)
      else if (showUserManagement) setShowUserManagement(false)
      else if (showProfileModal) setShowProfileModal(false)
      else if (showInvoiceModal) setShowInvoiceModal(false)
      else if (showTaxModal) setShowTaxModal(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [showProfileModal, showInvoiceModal, showInvoicePreview, showTaxModal, showUserManagement, showAuditModal, showUserModal, passwordReset.open, confirmState.isOpen, deleteState.isOpen, infoModal.isOpen])

  const showInfo = (title, message) => setInfoModal({ isOpen: true, title, message })

  const loadSettings = async () => {
    try {
      const settingsRes = await api.get('/settings')
      setSettings({ ...defaultSettings, ...settingsRes.data })
    } catch (err) {
      console.error('Load error:', err)
    }
  }

  const loadUsers = async () => {
    try {
      const response = await api.get('/auth/users')
      setUsers(response.data)
      return response.data
    } catch (err) {
      showInfo('Error', err.response?.data?.error || 'Failed to load users')
      return []
    }
  }

  const openAuditLog = async () => {
    setShowAuditModal(true)
    const list = users.length ? users : await loadUsers()
    setAuditUsers(list)
    loadAuditLogs(1)
  }

  const loadAuditLogs = async (page = 1, filters = auditFilters) => {
    setAuditLoading(true)
    try {
      const params = { page, pageSize: auditPagination.pageSize }
      Object.entries(filters).forEach(([key, value]) => { if (value) params[key] = value })
      const response = await api.get('/settings/audit-logs', { params })
      setAuditLogs(response.data.items)
      setAuditPagination(response.data.pagination)
    } catch (err) {
      showInfo('Error', err.response?.data?.error || 'Failed to load audit log')
    } finally {
      setAuditLoading(false)
    }
  }

  const saveSettings = async () => {
    try {
      const payload = Object.fromEntries(settingsFields.filter(key => settings[key] !== undefined).map(key => [key, settings[key]]))
      await api.put('/settings', payload)
      showInfo('Success', 'Saved successfully')
      loadSettings()
      return true
    } catch (err) {
      showInfo('Error', err.response?.data?.error || 'Save failed')
      return false
    }
  }

  const openUserModal = (selectedUser = null) => {
    if (selectedUser) {
      setEditUser(selectedUser)
      setUserForm({ name: selectedUser.name, email: selectedUser.email, password: '', role: selectedUser.role, is_active: selectedUser.is_active })
    } else {
      setEditUser(null)
      setUserForm({ name: '', email: '', password: '', role: 'cashier', is_active: true })
    }
    setShowUserModal(true)
  }

  const handleUserSubmit = async (e) => {
    e.preventDefault()
    try {
      if (editUser) await api.put(`/auth/users/${editUser.id}`, userForm)
      else await api.post('/auth/users', userForm)
      setShowUserModal(false)
      loadUsers()
      showInfo('Success', `User ${editUser ? 'updated' : 'created'}`)
    } catch (err) {
      showInfo('Error', err.response?.data?.error || 'Failed to save user')
    }
  }

  const toggleUserStatus = async () => {
    try {
      await api.put(`/auth/users/${confirmState.user.id}/status`, { is_active: confirmState.nextState })
      setConfirmState({ isOpen: false, user: null, nextState: false })
      loadUsers()
      if (showAuditModal) loadAuditLogs(1)
      showInfo('Success', `User ${confirmState.nextState ? 'activated' : 'deactivated'}`)
    } catch (err) {
      showInfo('Error', err.response?.data?.error || 'Failed to update user status')
    }
  }

  const resetPassword = async (e) => {
    e.preventDefault()
    try {
      await api.put(`/auth/users/${passwordReset.user.id}/password`, { password: passwordReset.password })
      setPasswordReset({ open: false, user: null, password: '' })
      if (showAuditModal) loadAuditLogs(1)
      showInfo('Success', 'Password reset successfully')
    } catch (err) {
      showInfo('Error', err.response?.data?.error || 'Failed to reset password')
    }
  }

  const deleteUser = async () => {
    try {
      await api.delete(`/auth/users/${deleteState.user.id}`)
      setDeleteState({ isOpen: false, user: null })
      loadUsers()
      if (showAuditModal) loadAuditLogs(1)
      showInfo('Success', 'User deleted successfully')
    } catch (err) {
      showInfo('Error', err.response?.data?.error || 'Failed to delete user')
    }
  }

  const downloadBackup = async () => {
    try {
      const res = await api.get('/settings/backup')
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `mmtc-pos-backup-${new Date().toISOString().split('T')[0]}.json`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch {
      showInfo('Error', 'Failed to download backup')
    }
  }

  const checkBackupFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setBackupChecking(true)
    try {
      const backup = JSON.parse(await file.text())
      const tables = backup?.tables
      const requiredTables = ['categories', 'users', 'products', 'customers', 'sales', 'sale_items', 'shop_settings']
      const missingTables = requiredTables.filter((name) => !Array.isArray(tables?.[name]))
      const invalidTables = tables && typeof tables === 'object'
        ? Object.entries(tables).filter(([, rows]) => !Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))).map(([name]) => name)
        : []
      const requiredFields = { categories: ['id', 'name'], users: ['id', 'email', 'role'], products: ['id', 'name', 'selling_price'], customers: ['id', 'name'], sales: ['id', 'bill_number'], sale_items: ['id', 'sale_id', 'product_id'], shop_settings: ['id', 'shop_name'] }
      const fieldIssues = tables && typeof tables === 'object' && !Array.isArray(tables)
        ? Object.entries(requiredFields).flatMap(([tableName, fields]) => Array.isArray(tables[tableName]) ? tables[tableName].flatMap((row, index) => fields.filter((field) => !row || !(field in row)).map((field) => `${tableName}[${index + 1}].${field}`)) : [])
        : []
      const compatible = backup?.format_version === 2 && backup?.app === 'MMTC POS' && tables && typeof tables === 'object' && !Array.isArray(tables) && missingTables.length === 0 && invalidTables.length === 0 && fieldIssues.length === 0
      const counts = tables && typeof tables === 'object' && !Array.isArray(tables)
        ? Object.fromEntries(Object.entries(tables).filter(([, rows]) => Array.isArray(rows)).map(([name, rows]) => [name, rows.length]))
        : {}
      setBackupCheck({ fileName: file.name, compatible, exportedAt: backup?.exported_at, missingTables, invalidTables, fieldIssues, counts, hasUsers: Array.isArray(tables?.users) })
    } catch {
      setBackupCheck({ fileName: file.name, compatible: false, error: 'File is not valid JSON or cannot be read.' })
    } finally {
      setBackupChecking(false)
    }
  }

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
  const printTestInvoice = () => {
    const shopName = escapeHtml(settings.shop_name || 'Your Shop')
    const address = escapeHtml(settings.address || '')
    const phone = escapeHtml(settings.phone || '')
    const footer = escapeHtml(settings.bill_footer || settings.thank_you_note || 'Thank you for shopping!')
    const receiptWidth = settings.printer_type === '58mm' ? '58mm' : '80mm'
    const content = `<!doctype html><html><head><meta charset="utf-8"><title>Printer Test</title><style>${settings.invoice_format === 'a4' ? '@page{size:A4;margin:16mm}' : `@page{size:${receiptWidth} auto;margin:4mm}`}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#111;margin:0 auto;width:${settings.invoice_format === 'a4' ? '100%' : receiptWidth};padding:2mm}h1{text-align:center;font-size:16px;margin:0 0 5px}p{margin:3px 0;text-align:center}.rule{border-top:1px dashed #333;margin:8px 0}.row{display:flex;justify-content:space-between;margin:5px 0}.muted{font-size:10px}</style></head><body><h1>${shopName}</h1>${address ? `<p>${address}</p>` : ''}${phone ? `<p>Phone: ${phone}</p>` : ''}<div class="rule"></div><p><b>PRINTER TEST</b></p><p class="muted">Sample only · no sale recorded</p><div class="rule"></div><div class="row"><span>Sample item × 2</span><span>₹200.00</span></div><div class="row"><span>Subtotal</span><span>₹200.00</span></div><div class="row"><b>Total</b><b>₹200.00</b></div><div class="rule"></div><p>${footer}</p><script>window.onload=()=>window.print()<\/script></body></html>`
    const frame = document.createElement('iframe')
    frame.setAttribute('aria-hidden', 'true')
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'
    frame.srcdoc = content
    document.body.appendChild(frame)
    frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); window.setTimeout(() => frame.remove(), 1000) }
  }

  if (user.role !== 'admin') return <div className="empty-state">Access denied</div>

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.35rem' }}>Manage your shop, billing, staff access, and records.</p>
        </div>
      </div>

      <div className="settings-section-grid">
        <button className="settings-section-card" onClick={() => setShowProfileModal(true)}>
          <span className="settings-section-kicker">SHOP</span><h2>Business Profile</h2>
          <p>{settings.shop_name || 'Add your shop name, contact details, and GST number.'}</p><span className="settings-section-action">Open settings <span aria-hidden="true">→</span></span>
        </button>
        <button className="settings-section-card" onClick={() => setShowInvoiceModal(true)}>
          <span className="settings-section-kicker">BILLING</span><h2>Invoice & Printer</h2>
          <p>{settings.printer_type || '80mm'} receipt · {settings.invoice_format === 'a4' ? 'A4 invoice' : 'Thermal invoice'}</p><span className="settings-section-action">Open settings <span aria-hidden="true">→</span></span>
        </button>
        <button className="settings-section-card" onClick={() => setShowTaxModal(true)}>
          <span className="settings-section-kicker">PREFERENCES</span><h2>Tax & Preferences</h2>
          <p>{settings.gst_enabled ? `GST enabled · ${settings.tax_percent || 0}%` : 'GST is disabled'} · stock alerts and defaults</p><span className="settings-section-action">Open settings <span aria-hidden="true">→</span></span>
        </button>
        <button className="settings-section-card" onClick={() => { setShowUserManagement(true); loadUsers() }}>
          <span className="settings-section-kicker">ACCESS</span><h2>User Management</h2>
          <p>Manage shop users, passwords, roles, and account status.</p><span className="settings-section-action">Manage users <span aria-hidden="true">→</span></span>
        </button>
        <button className="settings-section-card" onClick={openAuditLog}>
          <span className="settings-section-kicker">ACTIVITY</span><h2>Audit Log</h2>
          <p>See who changed shop settings and user accounts.</p><span className="settings-section-action">View activity <span aria-hidden="true">→</span></span>
        </button>
        <div className="settings-section-card settings-backup-card">
          <span className="settings-section-kicker">DATA</span><h2>Backup</h2>
          <p>Download shop records, sales, stock, udhaar, purchases, and settings.</p>
          <button className="btn btn-warning" onClick={downloadBackup}>Download complete backup</button>
          <label className="btn btn-secondary backup-check-button">Check backup file<input type="file" accept="application/json,.json" onChange={checkBackupFile} hidden /></label>
          {backupChecking && <p role="status">Checking backup file…</p>}
          {backupCheck && <div className={`backup-check-result ${backupCheck.compatible ? 'is-valid' : 'is-invalid'}`} role="status">
            <strong>{backupCheck.compatible ? 'Backup structure looks compatible' : 'Backup check found a problem'}</strong>
            <span>{backupCheck.fileName}{backupCheck.exportedAt ? ` · Exported ${new Date(backupCheck.exportedAt).toLocaleString()}` : ''}</span>
            {backupCheck.error && <span>{backupCheck.error}</span>}
            {backupCheck.missingTables?.length > 0 && <span>Missing sections: {backupCheck.missingTables.join(', ')}</span>}
            {backupCheck.invalidTables?.length > 0 && <span>Invalid sections: {backupCheck.invalidTables.join(', ')}</span>}
            {backupCheck.fieldIssues?.length > 0 && <span>Missing data fields: {backupCheck.fieldIssues.slice(0, 6).join(', ')}{backupCheck.fieldIssues.length > 6 ? ` · and ${backupCheck.fieldIssues.length - 6} more` : ''}</span>}
            {backupCheck.compatible && <span>{Object.entries(backupCheck.counts).map(([name, count]) => `${name.replaceAll('_', ' ')}: ${count}`).join(' · ')}</span>}
            {backupCheck.compatible && <span>User password hashes are intentionally excluded; restored staff accounts would need new passwords.</span>}
            {backupCheck.compatible && <span>This is a pre-restore check only; no shop data was changed.</span>}
          </div>}
        </div>
      </div>

      {showUserManagement && (
        <div className="modal-overlay" onClick={() => setShowUserManagement(false)}>
          <div className="modal settings-dialog settings-dialog-wide" role="dialog" aria-modal="true" aria-labelledby="settings-users-title" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><div><h2 id="settings-users-title">User Management</h2><p style={{ color: 'var(--text-secondary)', marginTop: '0.35rem' }}>Manage the people who can use this shop system.</p></div><button className="modal-close" aria-label="Close user management" onClick={() => setShowUserManagement(false)}>×</button></div>
            <div className="modal-body" style={{ flex: 1, overflow: 'auto' }}>
              <section className="role-permissions-summary" aria-label="Role permissions">
                <h3>Role access</h3>
                <p>These permissions are enforced by the server and reflected in the app menu.</p>
                <div className="settings-table-scroll"><table><thead><tr><th>Role</th><th>Access</th><th>Restricted actions</th></tr></thead><tbody>
                  <tr><td>Admin</td><td>All shop modules and settings</td><td>None</td></tr>
                  <tr><td>Manager</td><td>Billing, products, customers, credit, purchases, reports</td><td>User access, settings, audit log, backup</td></tr>
                  <tr><td>Cashier</td><td>Billing, customer name lookup, product lookup; own sales only</td><td>Customer balances/history, price changes, discounts, credit ledger, banking, purchases, reports, settings</td></tr>
                </tbody></table></div>
              </section>
              <div className="page-header" style={{ marginBottom: '1rem' }}><p>{users.length} shop {users.length === 1 ? 'user' : 'users'}</p><button className="btn btn-primary" style={{ width: 'auto' }} onClick={() => openUserModal()}>Add User</button></div>
              <div className="settings-table-scroll"><table className="settings-users-table">
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>{users.map(u => (
                  <tr key={u.id}>
                    <td>{u.name}</td><td>{u.email}</td><td style={{ textTransform: 'capitalize' }}>{u.role}</td>
                    <td style={{ color: u.is_active ? 'var(--primary)' : 'var(--danger)', fontWeight: 600 }}>{u.is_active ? 'Active' : 'Inactive'}</td>
                    <td><div className="action-buttons settings-user-actions">
                      <button className="btn btn-sm btn-secondary" onClick={() => openUserModal(u)}>Edit</button>
                      <button className="btn btn-sm btn-warning" onClick={() => setPasswordReset({ open: true, user: u, password: '' })}>Reset password</button>
                      <button className={`btn btn-sm ${u.is_active ? 'btn-danger' : 'btn-primary'}`} onClick={() => setConfirmState({ isOpen: true, user: u, nextState: !u.is_active })}>{u.is_active ? 'Deactivate' : 'Activate'}</button>
                      <button className="btn btn-sm btn-danger" onClick={() => setDeleteState({ isOpen: true, user: u })} disabled={u.id === user.id} title={u.id === user.id ? 'You cannot delete your own account' : 'Delete user'}>Delete</button>
                    </div></td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          </div>
        </div>
      )}

      {showAuditModal && (
        <div className="modal-overlay" onClick={() => setShowAuditModal(false)}>
          <div className="modal settings-dialog settings-dialog-wide" role="dialog" aria-modal="true" aria-labelledby="settings-audit-title" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><div><h2 id="settings-audit-title">Audit Log</h2><p style={{ color: 'var(--text-secondary)', marginTop: '0.35rem' }}>Search a record of account and shop setting changes.</p></div><button className="modal-close" aria-label="Close audit log" onClick={() => setShowAuditModal(false)}>×</button></div>
            <div className="modal-body" style={{ flex: 1, overflow: 'auto' }}>
              <form className="settings-audit-filters" onSubmit={e => { e.preventDefault(); loadAuditLogs(1) }} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                <input aria-label="Search audit activity" placeholder="Search activity" value={auditFilters.q} onChange={e => setAuditFilters({ ...auditFilters, q: e.target.value })} />
                <select aria-label="Filter by user" value={auditFilters.userId} onChange={e => setAuditFilters({ ...auditFilters, userId: e.target.value })}><option value="">All users</option>{auditUsers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                <input aria-label="Filter by action" placeholder="Action" value={auditFilters.action} onChange={e => setAuditFilters({ ...auditFilters, action: e.target.value })} />
                <input aria-label="From date" type="date" value={auditFilters.from} onChange={e => setAuditFilters({ ...auditFilters, from: e.target.value })} />
                <input aria-label="To date" type="date" value={auditFilters.to} onChange={e => setAuditFilters({ ...auditFilters, to: e.target.value })} />
                <button className="btn btn-primary" type="submit" disabled={auditLoading}>{auditLoading ? 'Searching…' : 'Search'}</button>
              </form>
              <div className="settings-table-scroll"><table className="settings-audit-table">
                <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
                <tbody>{auditLogs.map(log => (
                  <tr key={log.id}><td>{new Date(log.created_at).toLocaleString()}</td><td>{log.user_name || 'System'}</td><td>{log.action.replaceAll('_', ' ')}</td><td>{log.target_type || '-'}</td><td><details className="settings-audit-details"><summary>View details</summary><pre>{formatAuditDetails(log.details)}</pre></details></td></tr>
                ))}</tbody>
              </table></div>
              {!auditLogs.length && <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>{auditLoading ? 'Loading activity…' : 'No activity matches these filters.'}</p>}
              <div className="page-header" style={{ marginTop: '1rem' }}>
                <span>{auditPagination.total} activities · Page {auditPagination.page} of {Math.max(1, auditPagination.totalPages)}</span>
                <div className="action-buttons">
                  <button className="btn btn-secondary" disabled={auditPagination.page <= 1} onClick={() => loadAuditLogs(auditPagination.page - 1)}>Previous</button>
                  <button className="btn btn-secondary" disabled={auditPagination.page >= auditPagination.totalPages} onClick={() => loadAuditLogs(auditPagination.page + 1)}>Next</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showProfileModal && (
        <div className="modal-overlay" onClick={() => setShowProfileModal(false)}>
          <div className="modal settings-dialog settings-dialog-compact" role="dialog" aria-modal="true" aria-labelledby="settings-profile-title" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2 id="settings-profile-title">Business Profile</h2><button className="modal-close" aria-label="Close Business Profile" onClick={() => setShowProfileModal(false)}>×</button></div>
            <div className="modal-body" style={{ flex: 1, overflow: 'auto' }}>
              <div className="settings-form-grid">
                <div className="form-group settings-field-wide"><label>Shop Name</label><input type="text" value={settings.shop_name || ''} onChange={(e) => setSettings({ ...settings, shop_name: e.target.value })} /></div>
                <div className="form-group"><label>Phone</label><input type="text" value={settings.phone || ''} onChange={(e) => setSettings({ ...settings, phone: e.target.value })} /></div>
                <div className="form-group"><label>Email</label><input type="email" value={settings.email || ''} onChange={(e) => setSettings({ ...settings, email: e.target.value })} /></div>
                <div className="form-group settings-field-wide"><label>GST Number</label><input type="text" value={settings.gst_number || ''} onChange={(e) => setSettings({ ...settings, gst_number: e.target.value })} /></div>
                <div className="form-group settings-field-wide"><label>Address</label><textarea rows="2" value={settings.address || ''} onChange={(e) => setSettings({ ...settings, address: e.target.value })} /></div>
                <div className="form-group settings-field-wide"><label>Logo URL / Path <span className="settings-optional-label">Optional</span></label><input type="text" value={settings.logo_url || ''} onChange={(e) => setSettings({ ...settings, logo_url: e.target.value })} /></div>
              </div>
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowProfileModal(false)}>Cancel</button><button className="btn btn-primary" onClick={async () => { if (await saveSettings()) setShowProfileModal(false) }}>Save</button></div>
          </div>
        </div>
      )}

      {showInvoiceModal && (
        <div className="modal-overlay" onClick={() => setShowInvoiceModal(false)}>
          <div className="modal settings-dialog settings-dialog-compact" role="dialog" aria-modal="true" aria-labelledby="settings-invoice-title" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2 id="settings-invoice-title">Invoice & Printer</h2><button className="modal-close" aria-label="Close Invoice and Printer" onClick={() => setShowInvoiceModal(false)}>×</button></div>
            <div className="modal-body" style={{ flex: 1, overflow: 'auto' }}>
              <div className="settings-form-grid">
                <div className="form-group"><label>Bill Prefix</label><input type="text" value={settings.bill_prefix || ''} onChange={(e) => setSettings({ ...settings, bill_prefix: e.target.value })} /></div>
                <div className="form-group"><label>Invoice Format</label><select value={settings.invoice_format || 'thermal'} onChange={(e) => setSettings({ ...settings, invoice_format: e.target.value })}><option value="thermal">Thermal</option><option value="a4">A4</option></select></div>
                <div className="form-group"><label>Printer Type</label><select value={settings.printer_type || '80mm'} onChange={(e) => setSettings({ ...settings, printer_type: e.target.value })}><option value="58mm">58mm</option><option value="80mm">80mm</option></select></div>
                <div className="form-group"><label>Print Preview</label><select value={String(settings.print_preview)} onChange={(e) => setSettings({ ...settings, print_preview: e.target.value === 'true' })}><option value="true">Enabled</option><option value="false">Disabled</option></select></div>
                <div className="form-group"><label>Bill Footer</label><input type="text" value={settings.bill_footer || ''} onChange={(e) => setSettings({ ...settings, bill_footer: e.target.value })} /></div>
                <div className="form-group"><label>Thank You Note</label><input type="text" value={settings.thank_you_note || ''} onChange={(e) => setSettings({ ...settings, thank_you_note: e.target.value })} /></div>
              </div>
              <div className="invoice-preview-actions"><div><strong>Preview and test</strong><span>Print a sample receipt using this printer width. No sale is created.</span></div><button className="btn btn-secondary" type="button" onClick={() => setShowInvoicePreview(true)}>Preview sample</button></div>
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowInvoiceModal(false)}>Cancel</button><button className="btn btn-primary" onClick={async () => { if (await saveSettings()) setShowInvoiceModal(false) }}>Save</button></div>
          </div>
        </div>
      )}

      {showInvoicePreview && (
        <div className="modal-overlay settings-preview-overlay" onClick={() => setShowInvoicePreview(false)}>
          <div className="modal settings-dialog settings-dialog-compact invoice-sample-dialog" role="dialog" aria-modal="true" aria-labelledby="invoice-sample-title" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2 id="invoice-sample-title">Sample receipt preview</h2><button className="modal-close" aria-label="Close sample preview" onClick={() => setShowInvoicePreview(false)}>×</button></div>
            <div className="modal-body"><div className="invoice-sample-paper" style={{ width: settings.invoice_format === 'a4' ? '100%' : (settings.printer_type === '58mm' ? '58mm' : '80mm') }}>
              <h3>{settings.shop_name || 'Your Shop'}</h3>{settings.address && <p>{settings.address}</p>}{settings.phone && <p>Phone: {settings.phone}</p>}
              <hr /><strong>PRINTER TEST</strong><p className="sample-caption">Sample only · no sale recorded</p><hr />
              <div className="sample-invoice-row"><span>Sample item × 2</span><span>₹200.00</span></div><div className="sample-invoice-row"><span>Subtotal</span><span>₹200.00</span></div><div className="sample-invoice-row"><b>Total</b><b>₹200.00</b></div>
              <hr /><p>{settings.bill_footer || settings.thank_you_note || 'Thank you for shopping!'}</p>
            </div></div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowInvoicePreview(false)}>Close</button><button className="btn btn-primary" onClick={printTestInvoice}>Test print</button></div>
          </div>
        </div>
      )}

      {showTaxModal && (
        <div className="modal-overlay" onClick={() => setShowTaxModal(false)}>
          <div className="modal settings-dialog settings-dialog-compact" role="dialog" aria-modal="true" aria-labelledby="settings-tax-title" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2 id="settings-tax-title">Tax & Preferences</h2><button className="modal-close" aria-label="Close Tax and Preferences" onClick={() => setShowTaxModal(false)}>×</button></div>
            <div className="modal-body" style={{ flex: 1, overflow: 'auto' }}>
              <div className="settings-form-grid">
                <div className="form-group"><label>GST Enabled</label><select value={String(settings.gst_enabled)} onChange={(e) => setSettings({ ...settings, gst_enabled: e.target.value === 'true' })}><option value="true">Enabled</option><option value="false">Disabled</option></select></div>
                <div className="form-group"><label>Tax Percent</label><input type="number" step="0.01" value={settings.tax_percent || 0} onChange={(e) => setSettings({ ...settings, tax_percent: e.target.value })} /></div>
                <div className="form-group"><label>Financial Year Start</label><input type="text" value={settings.financial_year_start || ''} onChange={(e) => setSettings({ ...settings, financial_year_start: e.target.value })} /></div>
                <div className="form-group"><label>Low Stock Threshold</label><input type="number" value={settings.low_stock_threshold || 10} onChange={(e) => setSettings({ ...settings, low_stock_threshold: e.target.value })} /></div>
                <div className="form-group"><label>Default Payment Method</label><select value={settings.default_payment_method || 'cash'} onChange={(e) => setSettings({ ...settings, default_payment_method: e.target.value })}><option value="cash">Cash</option><option value="upi">UPI</option><option value="udhar">Credit</option></select></div>
                <div className="form-group"><label>Default Report Period</label><select value={settings.default_report_period || 'month'} onChange={(e) => setSettings({ ...settings, default_report_period: e.target.value })}><option value="today">Today</option><option value="week">Week</option><option value="month">Month</option><option value="year">Year</option><option value="financial-year">Financial Year</option></select></div>
                <div className="form-group"><label>Default Customer Label</label><input type="text" value={settings.default_customer_label || ''} onChange={(e) => setSettings({ ...settings, default_customer_label: e.target.value })} /></div>
                <div className="form-group"><label>Session Timeout (minutes)</label><input type="number" value={settings.session_timeout_minutes || 60} onChange={(e) => setSettings({ ...settings, session_timeout_minutes: e.target.value })} /></div>
              </div>
            </div>
            <div className="modal-footer"><button className="btn btn-secondary" onClick={() => setShowTaxModal(false)}>Cancel</button><button className="btn btn-primary" onClick={async () => { if (await saveSettings()) setShowTaxModal(false) }}>Save</button></div>
          </div>
        </div>
      )}

      {showUserModal && (
        <div className="modal-overlay" onClick={() => setShowUserModal(false)}>
          <div className="modal settings-dialog settings-dialog-form" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>{editUser ? 'Edit User' : 'Add User'}</h2><button className="modal-close" onClick={() => setShowUserModal(false)}>×</button></div>
            <form onSubmit={handleUserSubmit}>
              <div className="modal-body">
                <div className="form-group"><label>Name *</label><input type="text" value={userForm.name} onChange={(e) => setUserForm({ ...userForm, name: e.target.value })} required /></div>
                <div className="form-group"><label>Email *</label><input type="email" value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} required /></div>
                <div className="form-group"><label>{editUser ? 'New Password (optional)' : 'Password *'}</label><input type="password" value={userForm.password} onChange={(e) => setUserForm({ ...userForm, password: e.target.value })} required={!editUser} /></div>
                <div className="form-group"><label>Role *</label><select value={userForm.role} onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}><option value="admin">Admin</option><option value="manager">Manager</option><option value="cashier">Cashier</option></select></div>
                <div className="form-group"><label>Status</label><select value={String(userForm.is_active)} onChange={(e) => setUserForm({ ...userForm, is_active: e.target.value === 'true' })}><option value="true">Active</option><option value="false">Inactive</option></select></div>
              </div>
              <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setShowUserModal(false)}>Cancel</button><button type="submit" className="btn btn-primary">Save</button></div>
            </form>
          </div>
        </div>
      )}

      {passwordReset.open && (
        <div className="modal-overlay" onClick={() => setPasswordReset({ open: false, user: null, password: '' })}>
          <div className="modal settings-dialog settings-dialog-form" onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2>Reset Password</h2><button className="modal-close" onClick={() => setPasswordReset({ open: false, user: null, password: '' })}>×</button></div>
            <form onSubmit={resetPassword}>
              <div className="modal-body"><div className="form-group"><label>New Password *</label><input type="password" value={passwordReset.password} onChange={(e) => setPasswordReset({ ...passwordReset, password: e.target.value })} required /></div></div>
              <div className="modal-footer"><button type="button" className="btn btn-secondary" onClick={() => setPasswordReset({ open: false, user: null, password: '' })}>Cancel</button><button type="submit" className="btn btn-primary">Reset Password</button></div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmState.isOpen}
        title={`${confirmState.nextState ? 'Activate' : 'Deactivate'} User`}
        message={`Are you sure you want to ${confirmState.nextState ? 'activate' : 'deactivate'} "${confirmState.user?.name}"?`}
        confirmText={confirmState.nextState ? 'Activate' : 'Deactivate'}
        cancelText="Cancel"
        type={confirmState.nextState ? 'primary' : 'danger'}
        onConfirm={toggleUserStatus}
        onCancel={() => setConfirmState({ isOpen: false, user: null, nextState: false })}
      />

      <ConfirmModal
        isOpen={deleteState.isOpen}
        title="Delete User"
        message={`Are you sure you want to permanently delete "${deleteState.user?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        type="danger"
        onConfirm={deleteUser}
        onCancel={() => setDeleteState({ isOpen: false, user: null })}
      />

      <InfoModal
        isOpen={infoModal.isOpen}
        title={infoModal.title}
        message={infoModal.message}
        onClose={() => setInfoModal({ isOpen: false, title: '', message: '' })}
      />
    </div>
  )
}

export default Settings

