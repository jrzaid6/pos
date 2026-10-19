import axios from 'axios'

const api = axios.create({
  baseURL: '/api'
})

// Add token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Handle 401 errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const requestPath = (error.config?.url || '').split('?')[0].replace(/\/+$/, '')
    const isLoginRequest = /(?:^|\/)auth\/login$/.test(requestPath)

    if (error.response?.status === 401 && !isLoginRequest) {
      const code = error.response?.data?.code
      if (code === 'AUTH_ACCOUNT_INACTIVE' || code === 'AUTH_ACCOUNT_DELETED') {
        sessionStorage.setItem(
          'authNotice',
          error.response.data.error || 'Your account is inactive. Please contact your Business Owner.'
        )
      }
      localStorage.removeItem('token')
      localStorage.removeItem('user')
      window.location.href = '/'
    }
    return Promise.reject(error)
  }
)

export default api
