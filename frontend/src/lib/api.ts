import type { AuthUser } from './roles'

export type DatabaseHealth =
  | { status: 'ok'; latencyMs: number }
  | { status: 'down' }
  | { status: 'not_configured' }

export interface HealthResponse {
  status: 'ok' | 'degraded'
  app: {
    status: 'ok'
    name: string
    timezone: string
    uptimeSeconds: number
    timestamp: string
  }
  database: DatabaseHealth
}

export interface AuthResponse {
  user: AuthUser
}

export interface FieldIssue {
  path: string
  message: string
}

/** Error thrown for non-2xx API responses, carrying the server's safe message. */
export class ApiRequestError extends Error {
  readonly status: number
  readonly issues: FieldIssue[]

  constructor(status: number, message: string, issues: FieldIssue[] = []) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
    this.issues = issues
  }
}

/**
 * Name of the readable CSRF cookie issued by the backend. Must match
 * `SESSION_COOKIE_NAME + '_csrf'` there; changing the backend cookie name
 * means changing this too.
 */
const CSRF_COOKIE_NAME = 'ca_session_csrf'

function readCookie(name: string): string | undefined {
  for (const part of document.cookie.split(';')) {
    const separator = part.indexOf('=')
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim())
    }
  }
  return undefined
}

interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
}

/**
 * Calls the backend through the Vite dev proxy (/api -> :4000). Mutating
 * requests echo the CSRF cookie in X-CSRF-Token; the frontend never reads or
 * stores database credentials.
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { Accept: 'application/json' }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (method !== 'GET') {
    const csrfToken = readCookie(CSRF_COOKIE_NAME)
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken
    }
  }

  const response = await fetch(path, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'same-origin',
    signal: AbortSignal.timeout(10_000),
  })

  if (response.status === 204) {
    return undefined as T
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = undefined
  }

  if (!response.ok) {
    const errorBody = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
    const message = typeof errorBody.error === 'string' ? errorBody.error : `Request failed (HTTP ${response.status})`
    const issues = Array.isArray(errorBody.issues)
      ? (errorBody.issues as Array<{ path?: unknown; message?: unknown }>)
          .filter((issue) => typeof issue.path === 'string' && typeof issue.message === 'string')
          .map((issue) => ({ path: issue.path as string, message: issue.message as string }))
      : []
    throw new ApiRequestError(response.status, message, issues)
  }

  return payload as T
}

export async function fetchHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>('/api/health')
}
