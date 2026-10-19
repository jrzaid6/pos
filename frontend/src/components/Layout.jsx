import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import ConfirmModal from './ConfirmModal'

function Layout({ children, user, onLogout }) {
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  const handleLogoutClick = () => {
    setShowLogoutConfirm(true)
  }

  const handleLogoutConfirm = () => {
    setShowLogoutConfirm(false)
    onLogout()
  }

  const handleLogoutCancel = () => {
    setShowLogoutConfirm(false)
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>MMTC POS</h1>
        </div>
        
        <nav className="sidebar-nav">
          <NavLink to="/" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            Billing
          </NavLink>
          <NavLink to="/products" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            Products
          </NavLink>
          {(user.role === 'admin' || user.role === 'manager') && <>
            <NavLink to="/customers" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Customers</NavLink>
            <NavLink to="/credits" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Credit</NavLink>
            <NavLink to="/bank-cash" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Bank/Cash</NavLink>
            <NavLink to="/vendors" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>Vendors</NavLink>
          </>}
          {(user.role === 'admin' || user.role === 'manager') && (
            <NavLink to="/reports" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              Reports
            </NavLink>
          )}
          {user.role === 'admin' && (
            <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              Settings
            </NavLink>
          )}
        </nav>
        
        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-name">{user.name}</div>
            <div className="user-role">{user.role}</div>
          </div>
          <button className="btn btn-logout" onClick={handleLogoutClick}>
            Logout
          </button>
        </div>
      </aside>
      
      <main className="main-content">
        {children}
      </main>

      <ConfirmModal
        isOpen={showLogoutConfirm}
        title="Confirm Logout"
        message="Are you sure you want to logout?"
        confirmText="Logout"
        cancelText="Stay Logged In"
        type="danger"
        onConfirm={handleLogoutConfirm}
        onCancel={handleLogoutCancel}
      />
    </div>
  )
}

export default Layout
