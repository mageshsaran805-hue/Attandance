import { useEffect, useState } from 'react'
import { fetchHealth, type DatabaseHealth, type HealthResponse } from '../lib/api'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'success'; data: HealthResponse }
  | { kind: 'error'; message: string }

type Tone = 'loading' | 'ok' | 'warn' | 'error'

const dotClasses: Record<Tone, string> = {
  loading: 'bg-amber-400 animate-pulse',
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  error: 'bg-red-500',
}

function StatusLine({ tone, label, value }: { tone: Tone; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 text-sm">
      <span aria-hidden="true" className={`mt-1.5 inline-block size-2.5 shrink-0 rounded-full ${dotClasses[tone]}`} />
      <span className="text-slate-600">
        <span className="font-medium text-slate-800">{label}:</span> {value}
      </span>
    </div>
  )
}

function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`)
}

function DatabaseStatus({ database }: { database: DatabaseHealth }) {
  switch (database.status) {
    case 'ok':
      return <StatusLine tone="ok" label="Database" value={`Connected (${String(database.latencyMs)} ms)`} />
    case 'down':
      return <StatusLine tone="error" label="Database" value="Configured but unreachable" />
    case 'not_configured':
      return (
        <StatusLine
          tone="warn"
          label="Database"
          value="Not configured — add DATABASE_URL to backend/.env (see docs/setup.md)"
        />
      )
    default:
      return assertNever(database)
  }
}

export default function HealthIndicator() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false

    fetchHealth()
      .then((data) => {
        if (!cancelled) {
          setState({ kind: 'success', data })
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Unknown error',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [attempt])

  const handleRetry = () => {
    setState({ kind: 'loading' })
    setAttempt((value) => value + 1)
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-800">Backend &amp; database status</h3>
        <button
          type="button"
          onClick={handleRetry}
          disabled={state.kind === 'loading'}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state.kind === 'loading' ? 'Checking…' : 'Re-check'}
        </button>
      </div>

      <div className="mt-3 space-y-2">
        {state.kind === 'loading' && <StatusLine tone="loading" label="API server" value="Checking…" />}

        {state.kind === 'error' && (
          <>
            <StatusLine tone="error" label="API server" value="Unreachable" />
            <p className="pl-5 text-xs text-slate-500">
              {state.message}. Start the backend with <code className="rounded bg-slate-200 px-1">npm run dev</code> in{' '}
              <code className="rounded bg-slate-200 px-1">backend/</code> (expected at http://localhost:4000).
            </p>
          </>
        )}

        {state.kind === 'success' && (
          <>
            <StatusLine tone="ok" label="API server" value={`Online · ${state.data.app.timezone}`} />
            <DatabaseStatus database={state.data.database} />
            <p className="pl-5 text-xs text-slate-400">
              Checked at {new Date(state.data.app.timestamp).toLocaleTimeString()}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
