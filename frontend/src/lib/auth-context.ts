import { createContext, useContext } from 'react'
import type { AuthUser } from './roles'

export interface AuthContextValue {
  /** null when signed out; the current user when signed in. */
  user: AuthUser | null
  /** 'loading' until the initial /api/auth/me probe finishes. */
  status: 'loading' | 'ready'
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>')
  }
  return context
}
