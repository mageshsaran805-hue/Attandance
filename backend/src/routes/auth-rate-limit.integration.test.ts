import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { closePool, getPool } from '../db/pool.js';
import { cookieHeaderFrom, cookieValue } from '../test/helpers.js';

/**
 * Login rate limiting against a real database (failed attempts are audit
 * logged, so this needs TEST_DATABASE_URL). Kept in its own file so the
 * limiter store is not shared with the other integration tests.
 */

const enabled = Boolean(process.env.TEST_DATABASE_URL);

describe.skipIf(!enabled)('login rate limiting (real database)', () => {
  afterAll(async () => {
    // Failed attempts above are audit-logged; remove those rows so a test run
    // leaves the database exactly as it found it.
    await getPool().query(
      `DELETE FROM audit_log
        WHERE action = 'auth.login_failed'
          AND new_value->>'attemptedEmail' LIKE 'rate-limit-%@example.test'`,
    );
    await closePool();
  });

  it('returns 429 after 10 failed attempts from one IP', async () => {
    const app = createApp();
    const preflight = await request(app).get('/api/health');
    const cookie = cookieHeaderFrom(preflight);
    const csrfToken = cookieValue(preflight, 'ca_session_csrf') ?? '';

    let lastStatus = 0;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const res = await request(app)
        .post('/api/auth/login')
        .set('Cookie', cookie)
        .set('X-CSRF-Token', csrfToken)
        .send({ email: `rate-limit-${attempt}@example.test`, password: 'wrong-password' });
      lastStatus = res.status;
      if (attempt < 10) {
        expect(res.status).toBe(401);
      }
    }

    expect(lastStatus).toBe(429);
  });
});
