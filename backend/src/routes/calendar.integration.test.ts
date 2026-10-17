import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { defaultMigrationsDir, runMigrations } from '../db/migrate.js';
import { closePool, getPool } from '../db/pool.js';
import { hashPassword } from '../lib/password.js';
import { shiftDate, todayInTimeZone } from '../lib/time.js';
import { cookieHeaderFrom, cookieValue } from '../test/helpers.js';

/**
 * College calendar (non-working days) against a real database: admin CRUD
 * with validation, duplicate protection and audit logging; read access for
 * every signed-in role; range validation. Runs only when TEST_DATABASE_URL
 * is set (see src/test/setup.ts) and cleans up every row it creates.
 */

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const app = createApp();

const CSRF_COOKIE = 'ca_session_csrf';
const PASSWORD = 'Integration-Passw0rd!';
const runId = randomUUID().slice(0, 8);

const email = (label: string) => `it-cal-${label}-${runId}@example.test`;

const adminEmail = email('adm');
const facultyEmail = email('fac');
const studentEmail = email('stu');

/** Every row this suite creates carries this label prefix. */
const labelPrefix = `IT QA Holiday ${runId}`;
const holidayLabel = (name: string) => `${labelPrefix} ${name}`;

/** Small cookie/CSRF-aware API client (same pattern as other suites). */
class ApiSession {
  private cookie = '';
  private csrf = '';

  async bootstrap(): Promise<void> {
    const res = await request(app).get('/api/health');
    this.capture(res);
  }

  private capture(res: Response): void {
    const fresh = cookieHeaderFrom(res);
    if (fresh !== '') {
      this.cookie = fresh;
    }
    const token = cookieValue(res, CSRF_COOKIE);
    if (token !== undefined) {
      this.csrf = token;
    }
  }

  async login(targetEmail: string, password: string) {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Cookie', this.cookie)
      .set('X-CSRF-Token', this.csrf)
      .send({ email: targetEmail, password });
    this.capture(res);
    return res;
  }

  get(path: string) {
    return request(app).get(path).set('Cookie', this.cookie);
  }

  post(path: string, body?: unknown) {
    const req = request(app).post(path).set('Cookie', this.cookie).set('X-CSRF-Token', this.csrf);
    return body === undefined ? req : req.send(body);
  }

  delete(path: string) {
    return request(app).delete(path).set('Cookie', this.cookie).set('X-CSRF-Token', this.csrf);
  }
}

async function loginAs(targetEmail: string): Promise<ApiSession> {
  const session = new ApiSession();
  await session.bootstrap();
  const res = await session.login(targetEmail, PASSWORD);
  expect(res.status).toBe(200);
  return session;
}

describe.skipIf(!enabled)('calendar integration (real database)', () => {
  let adminId = '';
  let facultyId = '';

  const year = todayInTimeZone().slice(0, 4);
  const midJune = `${year}-06-15`;

  beforeAll(async () => {
    const pool = getPool();
    await runMigrations(pool, defaultMigrationsDir());

    const passwordHash = await hashPassword(PASSWORD);
    const users = await pool.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash, full_name, role, is_active) VALUES
         ($1, $4, 'CAL Admin', 'admin', true),
         ($2, $4, 'CAL Faculty', 'faculty', true),
         ($3, $4, 'CAL Student', 'student', true)
       RETURNING id, email`,
      [adminEmail, facultyEmail, studentEmail, passwordHash],
    );
    const byEmail = new Map(users.rows.map((row) => [row.email, row.id]));
    adminId = byEmail.get(adminEmail) ?? '';
    facultyId = byEmail.get(facultyEmail) ?? '';
    expect(adminId).not.toBe('');
    expect(facultyId).not.toBe('');
  });

  afterAll(async () => {
    const pool = getPool();
    const userIds = [adminId, facultyId].filter(Boolean);

    await pool.query('BEGIN');
    await pool.query('DELETE FROM non_working_days WHERE label LIKE $1', [`${labelPrefix}%`]);
    await pool.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1::uuid[])', [userIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    await pool.query('COMMIT');
    await closePool();
  });

  it('lets any signed-in role read the calendar but only admins change it', async () => {
    const anonymous = await request(app).get('/api/calendar/non-working-days');
    expect(anonymous.status).toBe(401);

    const faculty = await loginAs(facultyEmail);
    const list = await faculty.get(
      `/api/calendar/non-working-days?from=${year}-01-01&to=${year}-12-31`,
    );
    expect(list.status).toBe(200);
    expect(list.body.nonWorkingDays).toEqual([]);

    // Faculty and students cannot write; deleting is admin-only too.
    expect(
      (await faculty.post('/api/admin/calendar', { day: midJune, label: holidayLabel('Probe') }))
        .status,
    ).toBe(403);
    const student = await loginAs(studentEmail);
    expect(
      (await student.post('/api/admin/calendar', { day: midJune, label: holidayLabel('Probe') }))
        .status,
    ).toBe(403);
    expect((await faculty.delete(`/api/admin/calendar/${randomUUID()}`)).status).toBe(403);
  });

  it('creates, lists and deletes entries with an audit trail', async () => {
    const admin = await loginAs(adminEmail);

    const created = await admin.post('/api/admin/calendar', {
      day: midJune,
      label: holidayLabel('Founders Day'),
    });
    expect(created.status).toBe(201);
    expect(created.body.nonWorkingDay).toMatchObject({
      day: midJune,
      label: holidayLabel('Founders Day'),
    });
    const createdId = created.body.nonWorkingDay.id as string;
    expect(createdId).not.toBe('');

    const second = await admin.post('/api/admin/calendar', {
      day: `${year}-06-10`,
      label: holidayLabel('Study day'),
    });
    expect(second.status).toBe(201);
    const secondId = second.body.nonWorkingDay.id as string;

    // The default range is the current calendar year.
    const defaultRange = await admin.get('/api/calendar/non-working-days');
    expect(defaultRange.status).toBe(200);
    const defaultIds = (defaultRange.body.nonWorkingDays as Array<{ id: string }>).map(
      (row) => row.id,
    );
    expect(defaultIds).toContain(createdId);
    expect(defaultIds).toContain(secondId);

    // Entries come back oldest first and only within the requested range.
    const june = await admin.get(
      `/api/calendar/non-working-days?from=${year}-06-01&to=${year}-06-30`,
    );
    expect(
      (june.body.nonWorkingDays as Array<{ day: string }>).map((row) => row.day),
    ).toEqual([`${year}-06-10`, midJune]);

    const outside = await admin.get(
      `/api/calendar/non-working-days?from=${shiftDate(midJune, 1)}&to=${shiftDate(midJune, 30)}`,
    );
    expect(outside.body.nonWorkingDays).toEqual([]);

    // Faculty see the same calendar (students already proved read access for
    // the empty range above).
    const faculty = await loginAs(facultyEmail);
    const facultyView = await faculty.get(
      `/api/calendar/non-working-days?from=${year}-06-01&to=${year}-06-30`,
    );
    expect(facultyView.body.nonWorkingDays).toHaveLength(2);

    // Deleting requires admin and is idempotent-safe: the second attempt 404s.
    expect((await admin.delete(`/api/admin/calendar/${createdId}`)).status).toBe(204);
    expect((await admin.delete(`/api/admin/calendar/${createdId}`)).status).toBe(404);
    expect((await admin.delete(`/api/admin/calendar/${secondId}`)).status).toBe(204);

    const empty = await admin.get(
      `/api/calendar/non-working-days?from=${year}-06-01&to=${year}-06-30`,
    );
    expect(empty.body.nonWorkingDays).toEqual([]);

    const audit = await getPool().query<{ action: string }>(
      `SELECT action FROM audit_log
        WHERE actor_user_id = $1 AND action LIKE 'admin.calendar%'
        ORDER BY id`,
      [adminId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      'admin.calendar_create',
      'admin.calendar_create',
      'admin.calendar_delete',
      'admin.calendar_delete',
    ]);
  });

  it('validates input, duplicates and ranges', async () => {
    const admin = await loginAs(adminEmail);
    const path = '/api/admin/calendar';

    expect((await admin.post(path, { day: 'not-a-date', label: holidayLabel('X') })).status).toBe(
      400,
    );
    expect((await admin.post(path, { day: midJune, label: ' ' })).status).toBe(400);

    const created = await admin.post(path, { day: midJune, label: holidayLabel('Duplicate') });
    expect(created.status).toBe(201);
    const duplicate = await admin.post(path, { day: midJune, label: holidayLabel('Again') });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error).toMatch(/already marked/);

    const base = '/api/calendar/non-working-days';
    expect((await admin.get(`${base}?from=${year}-12-31&to=${year}-01-01`)).status).toBe(400);
    expect((await admin.get(`${base}?from=2020-01-01&to=${year}-12-31`)).status).toBe(400);
    expect((await admin.get(`${base}?from=2026-13-01`)).status).toBe(400);
  });
});
