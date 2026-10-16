import type { PoolClient } from 'pg';
import { getPool } from './pool.js';

/**
 * Runs `fn` inside a database transaction using a single pooled client.
 * Commits on success, rolls back on any error, always releases the client.
 * Use for multi-step changes (e.g. create student + enrollment + audit).
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
