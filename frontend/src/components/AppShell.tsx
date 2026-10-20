import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router'
import { useAuth } from '../lib/auth-context'
import { NAV_BY_ROLE } from '../lib/navigation'
import { ROLE_LABELS } from '../lib/roles'
import Logo from './Logo'

function navLinkClasses({ isActive }: { isActive: boolean }): string {
  return `whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 ${
    isActive
      ? 'bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-100'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
  }`
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
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
    <div className="flex min-h-svh flex-col bg-slate-50 text-slate-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-indigo-700 focus:shadow-lg"
      >
        Skip to main content
      </a>
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 shadow-sm shadow-slate-200/40 backdrop-blur">
        <h1 className="sr-only">College Attendance Management System</h1>
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <Logo compact />
          </div>

          {user && (
            <div className="flex items-center gap-2.5 sm:gap-3">
              <span
                aria-hidden="true"
                className="grid size-9 shrink-0 place-items-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 ring-1 ring-indigo-200"
              >
                {initials(user.fullName)}
              </span>
              <div className="hidden text-right min-[420px]:block">
                <p className="max-w-36 truncate text-sm font-medium leading-tight">{user.fullName}</p>
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
          <aside className="hidden w-52 shrink-0 py-8 md:sticky md:top-20 md:block md:self-start">
            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Workspace
            </p>
            <nav aria-label="Main" className="flex flex-col gap-1">
              {navItems.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClasses}>
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </aside>
        )}

        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 py-6 focus:outline-none sm:py-8"
        >
          {children}
        </main>
      </div>

      <footer className="mx-auto w-full max-w-6xl px-4 pb-8 text-center text-xs text-slate-500 sm:px-6">
        {import.meta.env.DEV
          ? 'Development build — use fake student data only.'
          : 'College Attendance Management System · Contact your college administrator for help.'}
      </footer>
    </div>
  )
}
