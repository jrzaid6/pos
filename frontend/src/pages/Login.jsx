import { useEffect, useRef, useState } from 'react'
import api from '../services/api'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const isValidLoginInput = (value) => {
  const trimmed = String(value || '').trim()
  if (!trimmed) return false
  if (trimmed.includes('@')) return EMAIL_REGEX.test(trimmed)
  return trimmed.length >= 3
}

const decodeToken = (token) => {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(padded)
    return JSON.parse(json)
  } catch {
    return null
  }
}

const isTokenExpired = (token) => {
  const decoded = decodeToken(token)
  if (!decoded || !decoded.exp) return false
  return decoded.exp * 1000 < Date.now()
}

function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const usernameRef = useRef(null)

  useEffect(() => {
    const authNotice = sessionStorage.getItem('authNotice')
    if (authNotice) {
      setMessage(authNotice)
      sessionStorage.removeItem('authNotice')
    }

    const existingToken = localStorage.getItem('token')
    if (existingToken && isTokenExpired(existingToken)) {
      localStorage.removeItem('token')
      localStorage.removeItem('user')
    }
    usernameRef.current?.focus()
  }, [])

  const getLoginMessage = (err) => {
    const status = err?.response?.status
    const code = err?.response?.data?.code

    if (status === 400 || code === 'AUTH_MISSING_FIELDS') {
      return 'Please enter username/email and password.'
    }

    if (code === 'AUTH_ACCOUNT_INACTIVE') {
      return err?.response?.data?.error || 'Your account is inactive. Please contact your Business Owner to reactivate it.'
    }

    if (code === 'AUTH_ACCOUNT_DELETED') {
      return 'This account no longer exists. Please contact your Business Owner.'
    }

    if (status === 403) {
      return 'Unable to login. Please contact your Business Owner.'
    }

    if (status === 429 || code === 'AUTH_RATE_LIMITED') {
      return 'Too many failed attempts. Try again after 15 minutes.'
    }

    if (status === 401 || code === 'AUTH_INVALID_CREDENTIALS') {
      return err?.response?.data?.error || 'Invalid username/email or password. If not registered, contact your Business Owner.'
    }

    if (!err?.response) {
      return 'Network issue. Please check internet and try again.'
    }

    return 'Unable to login right now. Please try again later.'
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setMessage('')

    const trimmedEmail = email.trim()
    const trimmedPassword = password

    if (!isValidLoginInput(trimmedEmail)) {
      setMessage('Please enter a valid username or email.')
      usernameRef.current?.focus()
      return
    }

    if (!trimmedPassword) {
      setMessage('Please enter your password.')
      return
    }

    if (trimmedEmail.includes('@') && !EMAIL_REGEX.test(trimmedEmail)) {
      setMessage('Email format looks incorrect. Please check and try again.')
      usernameRef.current?.focus()
      return
    }

    setLoading(true)

    try {
      const response = await api.post('/auth/login', {
        email: trimmedEmail.toLowerCase(),
        password: trimmedPassword
      })
      onLogin(response.data.user, response.data.token)
    } catch (err) {
      setMessage(getLoginMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-container">
      <div className="login-content">
        <section className="login-branding">
          <span className="login-brand-eyebrow">Riseam POS</span>
          <h1>
            <span>Billing &amp; Inventory</span>
            <span>Management System</span>
          </h1>
          <div className="login-brand-divider" aria-hidden="true" />
          <p className="login-brand-tagline">
            Fast billing. Smart stock. Clean reports.
          </p>
          <p className="login-brand-subline">
            Built for Indian wholesale counters.
          </p>
        </section>

        <section className="login-panel" aria-label="Login form">
          <h2 className="login-title">Login</h2>

          <form onSubmit={handleSubmit} className="login-form-minimal" noValidate>
            <div className="form-group login-line-group">
              <label htmlFor="login-username">Username or Email</label>
              <div className="login-input-line">
                <input
                  id="login-username"
                  ref={usernameRef}
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter username or email"
                  autoComplete="username"
                  spellCheck={false}
                  disabled={loading}
                />
              </div>
            </div>

            <div className="form-group login-line-group">
              <label htmlFor="login-password">Password</label>
              <div className="login-input-line login-password-line">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  disabled={loading}
                />
                <button
                  type="button"
                  className="login-password-toggle"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
              {loading ? (
                <span className="login-btn-loading">
                  <span className="login-spinner" aria-hidden="true" />
                  <span>Logging in...</span>
                </span>
              ) : (
                'Login'
              )}
            </button>

            <div className="login-status-slot" aria-live="polite">
              {message ? (
                <div className="login-status-message" role="alert">
                  {message}
                </div>
              ) : (
                <div className="login-status-placeholder" aria-hidden="true" />
              )}
            </div>
          </form>
        </section>
      </div>

      <p className="login-copyright">
        Riseam © {new Date().getFullYear()} All Rights Reserved.
      </p>
      <p className="login-beta">Beta v1.0</p>
    </div>
  )
}

export default Login
