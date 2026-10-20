import { useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import AuthLayout from '../components/AuthLayout'
import HealthIndicator from '../components/HealthIndicator'
import LoadingScreen from '../components/LoadingScreen'
import Alert from '../components/ui/Alert'
import Button from '../components/ui/Button'
import { PasswordField, TextField } from '../components/ui/FormField'
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
    <AuthLayout>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-200/60 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">Welcome back</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Sign in</h1>
        <p className="mt-1 text-sm text-slate-500">
          Use the account provided by your college administrator.
        </p>

        <form onSubmit={(event) => void handleSubmit(event)} className="mt-6 space-y-4" noValidate>
          <TextField
            id="email"
            label="Email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <PasswordField
            id="password"
            label="Password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          {error && <Alert>{error}</Alert>}

          <Button
            type="submit"
            variant="primary"
            className="w-full"
            loading={submitting}
            disabled={email.trim() === '' || password === ''}
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <div className="mt-6 border-t border-slate-100 pt-5">
          <p className="text-sm text-slate-500">
            New student without an account?{' '}
            <Link to="/register" className="font-medium text-indigo-600 hover:text-indigo-700">
              Submit a registration request
            </Link>
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Forgot your password? Contact your college administrator.
          </p>
        </div>

        {import.meta.env.DEV && (
          <details className="mt-5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <summary className="cursor-pointer select-none font-medium text-slate-600">
              Development seed accounts (fake data)
            </summary>
            <p className="mt-2">
              After running <code className="rounded bg-slate-200 px-1">npm run seed:dev</code>,
              every seeded account signs in with password{' '}
              <code className="rounded bg-slate-200 px-1">Demo@12345</code> — for example{' '}
              <code className="rounded bg-slate-200 px-1">admin@college.test</code> or{' '}
              <code className="rounded bg-slate-200 px-1">hod.cse@college.test</code>. See
              docs/setup.md for the full list.
            </p>
          </details>
        )}
      </section>

      {import.meta.env.DEV && (
        <div className="mt-6">
          <HealthIndicator />
        </div>
      )}
    </AuthLayout>
  )
}
