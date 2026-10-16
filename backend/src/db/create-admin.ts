import { z } from 'zod';
import { isDatabaseConfigured } from '../config/env.js';
import { hashPassword } from '../lib/password.js';
import { emailSchema, fullNameSchema, passwordSchema } from '../lib/schemas.js';
import { closePool, getPool } from './pool.js';

/**
 * Bootstraps an administrator account on a fresh database.
 *
 * The development seed inserts fake data and refuses to run with
 * NODE_ENV=production; this script is the production counterpart that
 * creates (or promotes and re-activates) a single admin account.
 *
 * Usage (backend/):
 *   ADMIN_EMAIL=you@college.edu ADMIN_PASSWORD='...' \
 *     [ADMIN_NAME='Full Name'] npm run create-admin
 *
 * Input comes from the environment so the script stays non-interactive;
 * mind your shell history. The password is validated against the same rules
 * as admin-created accounts and is never printed. Re-running with the same
 * email replaces the password and forces role=admin, is_active=true.
 */

const inputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: fullNameSchema,
});

async function createAdmin(): Promise<void> {
  const parsed = inputSchema.safeParse({
    email: process.env.ADMIN_EMAIL ?? '',
    password: process.env.ADMIN_PASSWORD ?? '',
    fullName: (process.env.ADMIN_NAME ?? 'Administrator').trim(),
  });

  if (!parsed.success) {
    console.error('[create-admin] invalid input:');
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    console.error(
      '[create-admin] provide ADMIN_EMAIL, ADMIN_PASSWORD (min 8 chars, at least one letter and one number) and optional ADMIN_NAME.',
    );
    process.exitCode = 1;
    return;
  }

  if (!isDatabaseConfigured) {
    throw new Error(
      'DATABASE_URL is not set. Fill in backend/.env first (see docs/deployment.md for production).',
    );
  }

  const { email, password, fullName } = parsed.data;
  const passwordHash = await hashPassword(password);

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query<{ id: string }>(
      'SELECT id FROM users WHERE lower(email) = lower($1)',
      [email],
    );
    const existingId = existing.rows[0]?.id;

    if (existingId) {
      await client.query(
        'UPDATE users SET full_name = $2, role = $3, is_active = true, password_hash = $4 WHERE id = $1',
        [existingId, fullName, 'admin', passwordHash],
      );
      console.log(`[create-admin] existing account updated and set to admin: ${email}`);
    } else {
      await client.query(
        'INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, $4)',
        [email, passwordHash, fullName, 'admin'],
      );
      console.log(`[create-admin] admin account created: ${email}`);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

createAdmin()
  .catch((error: unknown) => {
    console.error('[create-admin] error:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    closePool().catch(() => undefined);
  });
