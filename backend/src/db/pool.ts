import pg from 'pg';
import { env } from '../config/env.js';
import { ApiError } from '../lib/errors.js';

/**
 * PostgreSQL connection pool (Supabase-hosted).
 *
 * The pool is only created when DATABASE_URL is configured. TLS behaviour is
 * controlled entirely by the connection string (e.g. `?sslmode=require`);
 * certificate verification is never disabled here.
 */
const pool = env.DATABASE_URL
  ? new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    })
  : null;

// Idle clients can emit errors (e.g. server restarts); log them instead of
// letting them crash the process.
pool?.on('error', (error: Error) => {
  console.error('[db] idle client error:', error.message);
});

/**
 * Returns the pool, or throws a 503 ApiError when DATABASE_URL is unset.
 * Database-backed endpoints call this instead of using the pool directly so
 * an unconfigured database produces a clear response instead of a crash.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    throw new ApiError(503, 'Database is not configured on this server.');
  }
  return pool;
}

export type DatabaseHealth =
  | { status: 'ok'; latencyMs: number }
  | { status: 'down' }
  | { status: 'not_configured' };

/**
 * Lightweight connectivity probe used by /api/health.
 * Error details are logged server-side only and never returned to clients.
 */
export async function checkDatabase(): Promise<DatabaseHealth> {
  if (!pool) {
    return { status: 'not_configured' };
  }

  const startedAt = Date.now();
  try {
    await pool.query('SELECT 1');
    return { status: 'ok', latencyMs: Date.now() - startedAt };
  } catch (error) {
    console.error('[db] health check failed:', error instanceof Error ? error.message : error);
    return { status: 'down' };
  }
}

/** Closes the pool during graceful shutdown. */
export async function closePool(): Promise<void> {
  if (!pool) {
    return;
  }
  await pool.end();
}
