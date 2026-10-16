import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Pool, PoolClient } from 'pg';
import { isDatabaseConfigured } from '../config/env.js';
import { closePool, getPool } from './pool.js';

/**
 * Forward-only SQL migration runner (plain `pg`, no ORM).
 *
 * - Migrations live in `database/migrations/NNNN_description.sql` and are
 *   applied in numerical order, each inside its own transaction together
 *   with its `schema_migrations` bookkeeping row.
 * - Applied files are checksummed; modifying an applied migration is an error.
 * - A session-level advisory lock serializes concurrent runners.
 *
 * Usage: `npm run migrate` (backend/), after DATABASE_URL is configured.
 */

const MIGRATION_FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

/** Fixed advisory-lock key; any constant works as long as it never changes. */
const MIGRATION_LOCK_KEY = 7_274_110_001n;

export interface MigrationFile {
  number: number;
  filename: string;
  fullPath: string;
}

export function defaultMigrationsDir(): string {
  // Works from both src/ (tsx) and dist/ (compiled): backend/(src|dist)/db -> repo root.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../database/migrations');
}

export async function discoverMigrations(dir: string): Promise<MigrationFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const seenNumbers = new Map<string, string>();
  const files: MigrationFile[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const match = MIGRATION_FILE_PATTERN.exec(entry.name);
    if (!match) {
      if (entry.name.endsWith('.sql')) {
        throw new Error(
          `Invalid migration filename "${entry.name}": expected NNNN_short_description.sql (lowercase)`,
        );
      }
      continue;
    }
    const number = match[1] as string;
    const existing = seenNumbers.get(number);
    if (existing !== undefined) {
      throw new Error(`Duplicate migration number ${number}: "${existing}" and "${entry.name}"`);
    }
    seenNumbers.set(number, entry.name);
    files.push({ number: Number(number), filename: entry.name, fullPath: path.join(dir, entry.name) });
  }

  files.sort((a, b) => a.number - b.number);
  return files;
}

async function ensureSchemaMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
    DO $$
    DECLARE
      role_name text;
    BEGIN
      FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
          EXECUTE format('REVOKE ALL PRIVILEGES ON schema_migrations FROM %I', role_name);
        END IF;
      END LOOP;
    END
    $$;
  `);
}

export interface RunMigrationsResult {
  applied: string[];
}

export async function runMigrations(
  pool: Pool,
  migrationsDir: string,
  log: (message: string) => void = console.log,
): Promise<RunMigrationsResult> {
  const migrations = await discoverMigrations(migrationsDir);
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    // Serialize concurrent runners (e.g. two terminals running `npm run migrate`).
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY.toString()]);
    await ensureSchemaMigrationsTable(client);

    const recorded = await client.query<{ filename: string; checksum: string }>(
      'SELECT filename, checksum FROM schema_migrations',
    );
    const knownChecksums = new Map(recorded.rows.map((row) => [row.filename, row.checksum]));

    for (const migration of migrations) {
      const sql = await readFile(migration.fullPath, 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previousChecksum = knownChecksums.get(migration.filename);

      if (previousChecksum !== undefined) {
        if (previousChecksum !== checksum) {
          throw new Error(
            `Migration "${migration.filename}" was modified after it was applied. ` +
              'Never edit applied migrations — add a new migration instead.',
          );
        }
        continue;
      }

      log(`[migrate] applying ${migration.filename}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [
          migration.filename,
          checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`Migration "${migration.filename}" failed: ${reason}`, { cause: error });
      }
      applied.push(migration.filename);
      log(`[migrate] applied ${migration.filename}`);
    }

    for (const filename of knownChecksums.keys()) {
      if (!migrations.some((migration) => migration.filename === filename)) {
        log(
          `[migrate] warning: "${filename}" is recorded as applied but no longer exists under ${migrationsDir}`,
        );
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY.toString()]).catch(() => undefined);
    client.release();
  }

  return { applied };
}

async function main(): Promise<void> {
  if (!isDatabaseConfigured) {
    console.error(
      '[migrate] DATABASE_URL is not set. Copy backend/.env.example to backend/.env, paste your ' +
        'Supabase connection string, then run this command again.',
    );
    process.exitCode = 1;
    return;
  }

  const migrationsDir = defaultMigrationsDir();
  console.log(`[migrate] migrations directory: ${migrationsDir}`);

  const { applied } = await runMigrations(getPool(), migrationsDir);
  if (applied.length === 0) {
    console.log('[migrate] database is up to date; nothing to apply');
  } else {
    console.log(`[migrate] done: applied ${applied.length} migration(s)`);
  }
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main()
    .catch((error: unknown) => {
      console.error('[migrate] error:', error instanceof Error ? error.message : error);
      process.exitCode = 1;
    })
    .finally(() => {
      closePool().catch(() => undefined);
    });
}
