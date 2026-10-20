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
  key: string
  path: string
  data: T | null
  error: string | null
}

interface UseFetchOptions {
  /** Keep showing the last successful value while the same path reloads. */
  keepPreviousData?: boolean
}

/**
 * Minimal data-loading hook: fetches `path` whenever it changes and exposes a
 * manual reload. Pass `null` to stay idle (e.g. a modal's data source that
 * should only load while the modal is open).
 *
 * Loading is derived during render from a request key, so no state is set
 * synchronously inside the effect.
 */
export function useFetch<T>(path: string | null, options: UseFetchOptions = {}): FetchState<T> {
  const [result, setResult] = useState<Loaded<T> | null>(null)
  const [reloadCount, setReloadCount] = useState(0)
  const keepPreviousData = options.keepPreviousData === true

  const key = path === null ? null : `${reloadCount}\u0000${path}`

  useEffect(() => {
    if (path === null || key === null) {
      return
    }

    let cancelled = false
    apiFetch<T>(path)
      .then((data) => {
        if (!cancelled) {
          setResult({ key, path, data, error: null })
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setResult((previous) => ({
            key,
            path,
            data: keepPreviousData && previous?.path === path ? previous.data : null,
            error: cause instanceof ApiRequestError ? cause.message : 'Could not reach the server.',
          }))
        }
      })

    return () => {
      cancelled = true
    }
  }, [key, path, keepPreviousData])

  const reload = useCallback(() => {
    setReloadCount((count) => count + 1)
  }, [])

  const fresh = result !== null && result.key === key
  const previousForSamePath = result !== null && path !== null && result.path === path
  const showPrevious = keepPreviousData && previousForSamePath

  return {
    data: (fresh || showPrevious) && result !== null ? result.data : null,
    error: fresh && result !== null ? result.error : null,
    loading: key !== null && !fresh && !showPrevious,
    reload,
  }
}
