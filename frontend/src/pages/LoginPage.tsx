import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import HealthIndicator from '../components/HealthIndicator'
import LoadingScreen from '../components/LoadingScreen'
import { useAuth } from '../lib/auth-context'
import { ApiRequestError } from '../lib/api'
import { HOME_PATH_BY_ROLE } from '../lib/roles'

export default function LoginPage() {
  const { user, status, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (status === 'loading') {
    return <LoadingScreen label="Checking your session…" />
  }
  if (user) {
    return <Navigate to={HOME_PATH_BY_ROLE[user.role]} replace />
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await login(email.trim(), password)
      // Redirect happens through the `user` state above.
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        setError(caught.message)
      } else if (caught instanceof Error) {
        setError(caught.message)
      } else {
        setError('Sign-in failed. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col bg-slate-100 text-slate-900">
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10 sm:px-6">
        <div className="mb-6 flex items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-12 shrink-0 place-items-center rounded-2xl bg-indigo-600 text-2xl"
          >
            🎓
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">College Attendance</h1>
            <p className="text-sm text-slate-500">Daily morning attendance</p>
          </div>
        </div>

        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <h2 className="text-base font-semibold">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">
            Use the account provided by your college administrator.
          </p>

          <form onSubmit={(event) => void handleSubmit(event)} className="mt-5 space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-2 focus:outline-offset-0 focus:outline-indigo-600"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-2 focus:outline-offset-0 focus:outline-indigo-600"
              />
            </div>

            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || email.trim() === '' || password === ''}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700 focus:outline-2 focus:outline-offset-2 focus:outline-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <details className="mt-5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <summary className="cursor-pointer select-none font-medium text-slate-600">
              Development seed accounts (fake data)
            </summary>
            <p className="mt-2">
              After running <code className="rounded bg-slate-200 px-1">npm run seed:dev</code>, every
              seeded account signs in with password{' '}
              <code className="rounded bg-slate-200 px-1">Demo@12345</code> — for example{' '}
              <code className="rounded bg-slate-200 px-1">admin@college.test</code> or{' '}
              <code className="rounded bg-slate-200 px-1">hod.cse@college.test</code>. See
              docs/setup.md for the full list.
            </p>
          </details>
        </section>

        <div className="mt-6">
          <HealthIndicator />
        </div>
      </main>
    </div>
  )
}
