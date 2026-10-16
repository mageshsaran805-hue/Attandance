import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useAuth } from '../lib/auth-context'
import { HOME_PATH_BY_ROLE, type UserRole } from '../lib/roles'
import LoadingScreen from './LoadingScreen'

/**
 * Route guard: requires a signed-in user, optionally with one of the given
 * roles. Users visiting another role's area are redirected to their own home
 * instead of seeing an error. This is a UX guard only — the backend enforces
 * authorization on every request.
 */
export default function RequireAuth({ roles, children }: { roles?: UserRole[]; children: ReactNode }) {
  const { user, status } = useAuth()

  if (status === 'loading') {
    return <LoadingScreen label="Checking your session…" />
  }
  if (!user) {
    return <Navigate to="/login" replace />
  }
  if (roles && !roles.includes(user.role)) {
    return <Navigate to={HOME_PATH_BY_ROLE[user.role]} replace />
  }

  return children
}
