import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import api from './api'

export interface AuthUser {
  id: string
  email: string
  name: string
  role: string
  createdAt?: string
}

interface AuthState {
  token: string | null
  user: AuthUser | null
  hydrated: boolean
  setSession: (token: string, user: AuthUser) => void
  setUser: (user: AuthUser) => void
  logout: () => void
  setHydrated: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      hydrated: false,
      setSession: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      logout: () => set({ token: null, user: null }),
      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'acg_auth',
      storage: createJSONStorage(() => (typeof window !== 'undefined' ? window.localStorage : (undefined as any))),
      partialize: (s) => ({ token: s.token, user: s.user }),
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    }
  )
)

// Attach token to all axios requests
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers = config.headers || {}
    ;(config.headers as any).Authorization = `Bearer ${token}`
  }
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401 && typeof window !== 'undefined') {
      const { token, logout } = useAuthStore.getState()
      if (token) {
        logout()
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login?reason=expired'
        }
      }
    }
    return Promise.reject(err)
  }
)
