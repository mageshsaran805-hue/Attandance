import { useCallback, useEffect, useState } from 'react'
import { ApiRequestError, apiFetch } from './api'

export interface FetchState<T> {
  data: T | null
  error: string | null
  loading: boolean
  /** Refetches the same path (used after mutations). */
  reload: () => void
}

interface Loaded<T> {
  path: string
  data: T | null
  error: string | null
}

interface UseFetchOptions {
  /**
   * How often to refresh in the background while the page is visible.
   * Defaults to 20 seconds; pass 0 to disable interval polling.
   */
  refreshIntervalMs?: number
}

const DEFAULT_REFRESH_INTERVAL_MS = 20_000

/**
 * Minimal data-loading hook: fetches `path` whenever it changes and exposes a
 * manual reload. Pass `null` to stay idle (e.g. a modal's data source that
 * should only load while the modal is open).
 *
 * Data is also refreshed automatically so screens stay current when another
 * user changes something: every `refreshIntervalMs` while the tab is visible,
 * and immediately when the tab regains focus. Background reloads keep the
 * previous data on screen instead of flashing a loading skeleton.
 */
export function useFetch<T>(path: string | null, options: UseFetchOptions = {}): FetchState<T> {
  const [result, setResult] = useState<Loaded<T> | null>(null)
  const [reloadCount, setReloadCount] = useState(0)
  const refreshIntervalMs = options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS

  useEffect(() => {
    if (path === null) {
      return
    }

    let cancelled = false
    apiFetch<T>(path)
      .then((data) => {
        if (!cancelled) {
          setResult({ path, data, error: null })
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setResult((previous) => ({
            path,
            // Keep the last successful value for this path while a retry or
            // background refresh is failing; a different path starts empty.
            data: previous?.path === path ? previous.data : null,
            error: cause instanceof ApiRequestError ? cause.message : 'Could not reach the server.',
          }))
        }
      })

    return () => {
      cancelled = true
    }
  }, [path, reloadCount])

  const reload = useCallback(() => {
    setReloadCount((count) => count + 1)
  }, [])

  useEffect(() => {
    if (path === null) {
      return
    }

    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        reload()
      }
    }

    const timer =
      refreshIntervalMs > 0 ? window.setInterval(refreshIfVisible, refreshIntervalMs) : null
    window.addEventListener('focus', refreshIfVisible)
    document.addEventListener('visibilitychange', refreshIfVisible)

    return () => {
      if (timer !== null) {
        window.clearInterval(timer)
      }
      window.removeEventListener('focus', refreshIfVisible)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [path, refreshIntervalMs, reload])

  const current = result !== null && path !== null && result.path === path ? result : null

  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: path !== null && current === null,
    reload,
  }
}
