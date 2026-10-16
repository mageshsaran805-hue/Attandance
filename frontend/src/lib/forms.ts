import { useState } from 'react'
import { ApiRequestError } from './api'

/** Maps API field issues ({ path, message }) to a { field: message } record. */
export function issuesByField(error: unknown): Record<string, string> {
  const map: Record<string, string> = {}
  if (error instanceof ApiRequestError) {
    for (const issue of error.issues) {
      map[issue.path] = issue.message
    }
  }
  return map
}

export interface ActionState {
  busy: boolean
  error: string | null
  issues: Record<string, string>
  /** Clears error/issue state (call when opening a modal). */
  reset: () => void
  /** Runs an async action, capturing busy state and safe error messages. */
  run: (action: () => Promise<void>) => Promise<void>
}

/**
 * Shared state for modal form submissions: tracks busy, surfaces the server's
 * safe error message, and maps per-field validation issues.
 */
export function useAction(): ActionState {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<Record<string, string>>({})

  const reset = () => {
    setError(null)
    setIssues({})
  }

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    setIssues({})
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof ApiRequestError ? cause.message : 'Could not reach the server.')
      setIssues(issuesByField(cause))
    } finally {
      setBusy(false)
    }
  }

  return { busy, error, issues, reset, run }
}
