import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { apiFetch, ApiRequestError } from '../lib/api'
import { AuthContext } from '../lib/auth-context'
import type { AuthUser } from '../lib/roles'

interface AuthResponse {
  user: AuthUser
}

/**
 * Holds the signed-in user for the whole app. On mount it asks the backend
 * who is signed in (the session lives in an HTTP-only cookie, so only the
 * server can tell); login/logout update the state afterwards.
 */
export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')

  useEffect(() => {
    let cancelled = false

    apiFetch<AuthResponse>('/api/auth/me')
      .then((data) => {
        if (!cancelled) {
          setUser(data.user)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setStatus('ready')
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    try {
      const data = await apiFetch<AuthResponse>('/api/auth/login', {
        method: 'POST',
        body: { email, password },
      })
      setUser(data.user)
    } catch (error) {
      if (error instanceof ApiRequestError && error.issues.length > 0) {
        throw new Error(error.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '))
      }
      throw error
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await apiFetch<void>('/api/auth/logout', { method: 'POST' })
    } finally {
      // Even if the server call fails, forget the local session so the
      // interface never looks signed in while the cookie is invalid.
      setUser(null)
    }
  }, [])

  const value = useMemo(
    () => ({ user, status, login, logout }),
    [user, status, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
