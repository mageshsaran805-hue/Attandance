import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { cookieHeaderFrom, cookieValue } from './test/helpers.js';

/**
 * Application-level tests that run without any database connection
 * (setup.ts blanks DATABASE_URL unless TEST_DATABASE_URL is provided).
 */
const app = createApp();

const CSRF_COOKIE = 'ca_session_csrf';

// The two checks below need an UNCONFIGURED database; skip them when the
// integration-test database is provided (see src/test/setup.ts).
const hasTestDatabase = Boolean(process.env.TEST_DATABASE_URL);

describe('app behaviour without a database', () => {
  it.skipIf(hasTestDatabase)('GET /api/health reports the database as not_configured', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database.status).toBe('not_configured');
  });

  it('sets a CSRF cookie on plain GET requests', async () => {
    const res = await request(app).get('/api/health');

    expect(cookieValue(res, CSRF_COOKIE)).toBeTruthy();
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('GET /api/auth/me without a session returns 401', async () => {
    const res = await request(app).get('/api/auth/me');

    expect(res.status).toBe(401);
  });

  it('POST /api/auth/logout without a session returns 401', async () => {
    const preflight = await request(app).get('/api/health');
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', cookieHeaderFrom(preflight))
      .set('X-CSRF-Token', cookieValue(preflight, CSRF_COOKIE) ?? '');

    expect(res.status).toBe(401);
  });

  it('POST /api/auth/login without a CSRF token returns 403', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'someone@example.test', password: 'whatever' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/CSRF/);
  });

  it('POST /api/auth/login with mismatched CSRF tokens returns 403', async () => {
    const preflight = await request(app).get('/api/health');
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookieHeaderFrom(preflight))
      .set('X-CSRF-Token', 'not-the-cookie-value')
      .send({ email: 'someone@example.test', password: 'whatever' });

    expect(res.status).toBe(403);
  });

  it('POST /api/auth/login validates the body before touching the database', async () => {
    const preflight = await request(app).get('/api/health');
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookieHeaderFrom(preflight))
      .set('X-CSRF-Token', cookieValue(preflight, CSRF_COOKIE) ?? '')
      .send({ email: 'not-an-email', password: '' });

    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.issues)).toBe(true);
  });

  it.skipIf(hasTestDatabase)('POST /api/auth/login with valid input but no database returns 503', async () => {
    const preflight = await request(app).get('/api/health');
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', cookieHeaderFrom(preflight))
      .set('X-CSRF-Token', cookieValue(preflight, CSRF_COOKIE) ?? '')
      .send({ email: 'someone@example.test', password: 'whatever' });

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Database is not configured/);
  });
});
