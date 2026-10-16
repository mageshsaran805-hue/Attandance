import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { defaultMigrationsDir, runMigrations } from '../db/migrate.js';
import { closePool, getPool } from '../db/pool.js';
import { hashPassword } from '../lib/password.js';
import { cookieHeaderFrom, cookieValue } from '../test/helpers.js';

/**
 * Full auth flows against a real database.
 *
 * Runs only when TEST_DATABASE_URL is set (see src/test/setup.ts) — a
 * disposable database, never the development one. The migration runner is
 * exercised here too: beforeAll applies all pending migrations.
 */

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const app = createApp();

const CSRF_COOKIE = 'ca_session_csrf';
const SESSION_COOKIE = 'ca_session';
const PASSWORD = 'Integration-Passw0rd!';
const runId = randomUUID().slice(0, 8);

const adminEmail = `it-admin-${runId}@example.test`;
const disabledEmail = `it-student-disabled-${runId}@example.test`;

describe.skipIf(!enabled)('auth integration (real database)', () => {
  let adminId = '';
  let disabledId = '';

  beforeAll(async () => {
    const pool = getPool();
    await runMigrations(pool, defaultMigrationsDir());

    const passwordHash = await hashPassword(PASSWORD);
    const inserted = await pool.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash, full_name, role, is_active)
       VALUES ($1, $3, 'Integration Admin', 'admin', true),
              ($2, $3, 'Integration Disabled', 'student', false)
       RETURNING id, email`,
      [adminEmail, disabledEmail, passwordHash],
    );
    for (const row of inserted.rows) {
      if (row.email === adminEmail) {
        adminId = row.id;
      } else if (row.email === disabledEmail) {
        disabledId = row.id;
      }
    }
    expect(adminId).not.toBe('');
    expect(disabledId).not.toBe('');
  });

  afterAll(async () => {
    const pool = getPool();
    const ids = [adminId, disabledId].filter((id) => id !== '');
    if (ids.length > 0) {
      await pool.query(
        `DELETE FROM audit_log
         WHERE actor_user_id = ANY($1::uuid[])
            OR entity_id = ANY($1::text[])
            OR new_value->>'attemptedEmail' = ANY($2::text[])`,
        [ids, [adminEmail, disabledEmail]],
      );
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
    }
    await closePool();
  });

  async function csrfSession(): Promise<{ cookie: string; token: string }> {
    const res = await request(app).get('/api/health');
    return {
      cookie: cookieHeaderFrom(res),
      token: cookieValue(res, CSRF_COOKIE) ?? '',
    };
  }

  it('rejects a wrong password with 401 and a generic message', async () => {
    const { cookie, token } = await csrfSession();
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token)
      .send({ email: adminEmail, password: 'wrong-password' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid email or password' });
  });

  it('rejects a correct password on a deactivated account with 403', async () => {
    const { cookie, token } = await csrfSession();
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token)
      .send({ email: disabledEmail, password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/deactivated/);
  });

  it('logs in with valid credentials and issues session and CSRF cookies', async () => {
    const { cookie, token } = await csrfSession();
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token)
      .send({ email: adminEmail, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      id: adminId,
      email: adminEmail,
      fullName: 'Integration Admin',
      role: 'admin',
    });
    expect(res.body.user).not.toHaveProperty('passwordHash');
    expect(cookieValue(res, SESSION_COOKIE)).toBeTruthy();
    expect(cookieValue(res, CSRF_COOKIE)).toBeTruthy();
  });

  it('serves /api/auth/me for a valid session and 401 without one', async () => {
    const { cookie, token } = await csrfSession();
    const login = await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token)
      .send({ email: adminEmail, password: PASSWORD });
    expect(login.status).toBe(200);

    const loggedInCookie = cookieHeaderFrom(login);

    const me = await request(app).get('/api/auth/me').set('Cookie', loggedInCookie);
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ id: adminId, role: 'admin' });

    const anonymous = await request(app).get('/api/auth/me');
    expect(anonymous.status).toBe(401);

    const forged = await request(app).get('/api/auth/me').set('Cookie', `${SESSION_COOKIE}=forged-token`);
    expect(forged.status).toBe(401);
  });

  it('logout clears the session cookie', async () => {
    const { cookie, token } = await csrfSession();
    const login = await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookie)
      .set('X-CSRF-Token', token)
      .send({ email: adminEmail, password: PASSWORD });
    const loggedInCookie = cookieHeaderFrom(login);
    const loggedInCsrf = cookieValue(login, CSRF_COOKIE) ?? '';

    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', loggedInCookie)
      .set('X-CSRF-Token', loggedInCsrf);

    expect(logout.status).toBe(204);
    const clearedSession = cookieValue(logout, SESSION_COOKIE);
    expect(clearedSession === undefined || clearedSession === '').toBe(true);
  });
});
