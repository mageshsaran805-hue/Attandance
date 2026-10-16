import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router'
import { useAuth } from '../lib/auth-context'
import { NAV_BY_ROLE } from '../lib/navigation'
import { ROLE_LABELS } from '../lib/roles'

function navLinkClasses({ isActive }: { isActive: boolean }): string {
  return `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
    isActive
      ? 'bg-indigo-50 text-indigo-700'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`
}

/**
 * Signed-in page frame: top bar with identity and sign-out, role-based
 * navigation (side rail on desktop, scrollable strip on mobile) and the
 * content area.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await logout()
      navigate('/login', { replace: true })
    } finally {
      setSigningOut(false)
    }
  }

  const navItems = user ? NAV_BY_ROLE[user.role] : []

  return (
    <div className="flex min-h-svh flex-col bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-4 sm:px-6">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-600 text-xl"
          >
            🎓
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold sm:text-lg">
              College Attendance Management System
            </h1>
            <p className="text-xs text-slate-500 sm:text-sm">Daily morning attendance</p>
          </div>

          {user && (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm font-medium leading-tight">{user.fullName}</p>
                <p className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  void handleSignOut()
                }}
                disabled={signingOut}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          )}
        </div>
      </header>

      {user && navItems.length > 0 && (
        <div className="border-b border-slate-200 bg-white md:hidden">
          <nav
            aria-label="Main"
            className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4 py-2 sm:px-6"
          >
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClasses}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-8 px-4 sm:px-6">
        {user && navItems.length > 0 && (
          <aside className="hidden w-52 shrink-0 py-8 md:block">
            <nav aria-label="Main" className="flex flex-col gap-1">
              {navItems.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClasses}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </aside>
        )}

        <main className="min-w-0 flex-1 py-8">{children}</main>
      </div>

      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-center text-xs text-slate-400 sm:px-6">
        Development build — use fake student data only.
      </footer>
    </div>
  )
}
