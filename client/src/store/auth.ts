import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { AuthUser } from '../types/gis'

interface AuthState {
  token: string | null
  refreshToken: string | null
  user: AuthUser | null
  setToken: (token: string | null) => void
  setRefreshToken: (token: string | null) => void
  setAuthTokens: (accessToken: string | null, refreshToken: string | null) => void
  setUser: (user: AuthUser | null) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      user: null,
      setToken: (token) => set({ token }),
      setRefreshToken: (refreshToken) => set({ refreshToken }),
      setAuthTokens: (token, refreshToken) => set({ token, refreshToken }),
      setUser: (user) => set({ user }),
      logout: () => set({ token: null, refreshToken: null, user: null }),
    }),
    {
      name: 'enterprise-gis-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ token: state.token, refreshToken: state.refreshToken, user: state.user }),
    },
  ),
)
