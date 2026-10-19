import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import api from './services/api'
import Login from './pages/Login'
import POS from './pages/POS'
import Products from './pages/Products'
import Customers from './pages/Customers'
import Reports from './pages/Reports'
import Credits from './pages/Credits'
import Settings from './pages/Settings'
import BankCash from './pages/BankCash'
import Vendors from './pages/Vendors'
import Layout from './components/Layout'

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')
    const userData = localStorage.getItem('user')
    if (token && userData) {
      setUser(JSON.parse(userData))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!user || !localStorage.getItem('token')) return undefined

    const verifySession = () => {
      api.get('/auth/profile').catch(() => {})
    }

    const intervalId = window.setInterval(verifySession, 30 * 1000)
    return () => window.clearInterval(intervalId)
  }, [user])

  const handleLogin = (userData, token) => {
    localStorage.setItem('token', token)
    localStorage.setItem('user', JSON.stringify(userData))
    setUser(userData)
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    setUser(null)
  }

  if (loading) {
    return <div className="loading">Loading...</div>
  }

  if (!user) {
    return <Login onLogin={handleLogin} />
  }

  return (
    <BrowserRouter>
      <Layout user={user} onLogout={handleLogout}>
        <Routes>
          <Route path="/" element={<POS user={user} />} />
          <Route path="/products" element={<Products user={user} />} />
          <Route path="/customers" element={user.role === 'cashier' ? <Navigate to="/" replace /> : <Customers />} />
          <Route path="/reports" element={user.role === 'admin' || user.role === 'manager' ? <Reports user={user} /> : <Navigate to="/" replace />} />
          <Route path="/credits" element={user.role === 'admin' || user.role === 'manager' ? <Credits /> : <Navigate to="/" replace />} />
          <Route path="/bank-cash" element={user.role === 'admin' || user.role === 'manager' ? <BankCash user={user} /> : <Navigate to="/" replace />} />
          <Route path="/vendors" element={user.role === 'admin' || user.role === 'manager' ? <Vendors user={user} /> : <Navigate to="/" replace />} />
          <Route path="/settings" element={user.role === 'admin' ? <Settings user={user} /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}

export default App
