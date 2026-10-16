import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { defaultMigrationsDir, runMigrations } from '../db/migrate.js';
import { closePool, getPool } from '../db/pool.js';
import { hashPassword } from '../lib/password.js';
import { cookieHeaderFrom, cookieValue } from '../test/helpers.js';

/**
 * Phase 6 student self-registration: the public request form, the duplicate
 * guards, and the admin review queue (single + bulk approve/reject) against a
 * real database.
 *
 * Runs only when TEST_DATABASE_URL is set (see src/test/setup.ts) — a
 * disposable database, never the development one.
 */

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const app = createApp();

const CSRF_COOKIE = 'ca_session_csrf';
const PASSWORD = 'Integration-Passw0rd!';
const runId = randomUUID().slice(0, 8);

const email = (label: string) => `it-reg-${label}-${runId}@example.test`;

const adminEmail = email('adm');
const facultyEmail = email('fac');
const existingStudentEmail = email('stuexisting');

/** Small cookie/CSRF-aware API client (same shape as the other suites). */
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
}

async function loginAs(targetEmail: string): Promise<ApiSession> {
  const session = new ApiSession();
  await session.bootstrap();
  const res = await session.login(targetEmail, PASSWORD);
  expect(res.status).toBe(200);
  return session;
}

describe.skipIf(!enabled)('student registration integration (real database)', () => {
  const registrationIds: string[] = [];

  let adminId = '';
  let facultyId = '';
  let existingStudentId = '';
  let departmentId = '';
  let classId = '';

  /** Submits a registration through the public endpoint; returns the id. */
  async function submitRegistration(
    session: ApiSession,
    input: {
      email: string;
      registerNumber: string;
      phone?: string;
      classId?: string;
    },
  ) {
    const res = await session.post('/api/registration', {
      fullName: `Reg Student ${input.registerNumber}`,
      email: input.email,
      registerNumber: input.registerNumber,
      ...(input.phone === undefined ? {} : { phone: input.phone }),
      classId: input.classId ?? classId,
      password: PASSWORD,
    });
    if (res.status === 201) {
      registrationIds.push(res.body.registration.id as string);
    }
    return res;
  }

  beforeAll(async () => {
    const pool = getPool();
    await runMigrations(pool, defaultMigrationsDir());

    const passwordHash = await hashPassword(PASSWORD);
    const users = await pool.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash, full_name, role, is_active) VALUES
         ($1, $4, 'REG Admin', 'admin', true),
         ($2, $4, 'REG Faculty', 'faculty', true),
         ($3, $4, 'REG Existing Student', 'student', true)
       RETURNING id, email`,
      [adminEmail, facultyEmail, existingStudentEmail, passwordHash],
    );
    const byEmail = new Map(users.rows.map((row) => [row.email, row.id]));
    adminId = byEmail.get(adminEmail) ?? '';
    facultyId = byEmail.get(facultyEmail) ?? '';
    existingStudentId = byEmail.get(existingStudentEmail) ?? '';

    const departments = await pool.query<{ id: string }>(
      `INSERT INTO departments (name, code) VALUES ($1, $2) RETURNING id`,
      [`REG QA Dept ${runId}`, `R${runId.slice(0, 4)}`],
    );
    departmentId = departments.rows[0]?.id ?? '';

    const classes = await pool.query<{ id: string }>(
      `INSERT INTO classes (department_id, name, academic_year) VALUES ($1, $2, '2026-27') RETURNING id`,
      [departmentId, `REG QA Class ${runId}`],
    );
    classId = classes.rows[0]?.id ?? '';

    for (const id of [adminId, facultyId, existingStudentId, departmentId, classId]) {
      expect(id).not.toBe('');
    }
  });

  afterAll(async () => {
    const pool = getPool();
    const pattern = `it-reg-%-${runId}@example.test`;
    const created = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email LIKE $1`,
      [pattern],
    );
    const createdUserIds = created.rows.map((row) => row.id);
    const entityIds = [...registrationIds, ...createdUserIds];

    await pool.query('DELETE FROM audit_log WHERE entity_id = ANY($1::text[]) OR actor_user_id = ANY($2::uuid[])', [
      entityIds,
      [adminId, facultyId],
    ]);
    await pool.query('DELETE FROM enrollments WHERE class_id = $1', [classId]);
    await pool.query('DELETE FROM student_registrations WHERE class_id = $1', [classId]);
    await pool.query('DELETE FROM classes WHERE id = $1', [classId]);
    await pool.query('DELETE FROM departments WHERE id = $1', [departmentId]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
      [adminId, facultyId, existingStudentId, ...createdUserIds],
    ]);
    await closePool();
  });

  it('lists departments and classes publicly for the registration form', async () => {
    const publicSession = new ApiSession();
    await publicSession.bootstrap();

    const res = await publicSession.get('/api/registration/classes');
    expect(res.status).toBe(200);

    const department = (res.body.departments as Array<{ id: string; classes: Array<{ id: string }> }>).find(
      (entry) => entry.id === departmentId,
    );
    expect(department?.classes.map((entry) => entry.id)).toContain(classId);
  });

  it('accepts a registration request without creating an account', async () => {
    const publicSession = new ApiSession();
    await publicSession.bootstrap();

    const requestEmail = email('one');
    const res = await submitRegistration(publicSession, {
      email: requestEmail,
      registerNumber: `REG-${runId}-1`,
      phone: '+91 98765 43210',
    });
    expect(res.status).toBe(201);
    expect(res.body.registration.status).toBe('pending');

    const pool = getPool();
    const registration = await pool.query<{
      status: string;
      email: string;
      register_number: string;
      phone: string | null;
      password_hash: string;
    }>(
      `SELECT status, email, register_number, phone, password_hash
         FROM student_registrations WHERE id = $1`,
      [res.body.registration.id],
    );
    expect(registration.rows[0]).toMatchObject({
      status: 'pending',
      email: requestEmail,
      register_number: `REG-${runId}-1`,
      phone: '+91 98765 43210',
    });
    expect(registration.rows[0]?.password_hash.startsWith('$argon2')).toBe(true);

    const account = await pool.query(`SELECT id FROM users WHERE lower(email) = lower($1)`, [
      requestEmail,
    ]);
    expect(account.rowCount).toBe(0);

    const audit = await pool.query<{ action: string; actor_user_id: string | null }>(
      `SELECT action, actor_user_id FROM audit_log WHERE entity_id = $1`,
      [res.body.registration.id],
    );
    expect(audit.rows[0]?.action).toBe('registration.submit');
    expect(audit.rows[0]?.actor_user_id).toBeNull();
  });

  it('refuses duplicate emails, duplicate register numbers and unknown classes', async () => {
    const publicSession = new ApiSession();
    await publicSession.bootstrap();

    // Existing user account.
    const userEmail = await submitRegistration(publicSession, {
      email: existingStudentEmail,
      registerNumber: `REG-${runId}-2`,
    });
    expect(userEmail.status).toBe(409);

    // Same email as the pending request from the previous test.
    const duplicateEmail = await submitRegistration(publicSession, {
      email: email('one'),
      registerNumber: `REG-${runId}-3`,
    });
    expect(duplicateEmail.status).toBe(409);

    // Same register number as the pending request.
    const duplicateRegister = await submitRegistration(publicSession, {
      email: email('two'),
      registerNumber: `REG-${runId}-1`,
    });
    expect(duplicateRegister.status).toBe(409);

    // Unknown class.
    const unknownClass = await submitRegistration(publicSession, {
      email: email('three'),
      registerNumber: `REG-${runId}-4`,
      classId: randomUUID(),
    });
    expect(unknownClass.status).toBe(400);
  });

  it('does not let the student sign in before approval', async () => {
    const student = new ApiSession();
    await student.bootstrap();
    const res = await student.login(email('one'), PASSWORD);
    expect(res.status).toBe(401);
  });

  it('shows the queue to administrators only', async () => {
    const faculty = await loginAs(facultyEmail);
    expect((await faculty.get('/api/admin/registrations')).status).toBe(403);

    const admin = await loginAs(adminEmail);
    const res = await admin.get('/api/admin/registrations');
    expect(res.status).toBe(200);
    const entry = (res.body.items as Array<{ email: string; class: { id: string } }>).find(
      (item) => item.email === email('one'),
    );
    expect(entry?.class.id).toBe(classId);

    const overview = await admin.get('/api/admin/overview');
    expect(overview.body.counts.pendingRegistrations).toBeGreaterThanOrEqual(1);
  });

  it('approves a request: account created, enrolled, audited, can sign in', async () => {
    const admin = await loginAs(adminEmail);
    const pool = getPool();

    const pending = await pool.query<{ id: string }>(
      `SELECT id FROM student_registrations WHERE email = $1 AND status = 'pending'`,
      [email('one')],
    );
    const registrationId = pending.rows[0]?.id ?? '';
    expect(registrationId).not.toBe('');

    const res = await admin.post('/api/admin/registrations/approve', { ids: [registrationId] });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ id: registrationId, ok: true });
    expect(res.body.approved).toBe(1);

    const user = await pool.query<{
      id: string;
      role: string;
      is_active: boolean;
      register_number: string | null;
      phone: string | null;
    }>(
      `SELECT id, role, is_active, register_number, phone FROM users WHERE email = $1`,
      [email('one')],
    );
    expect(user.rows[0]).toMatchObject({
      role: 'student',
      is_active: true,
      register_number: `REG-${runId}-1`,
      phone: '+91 98765 43210',
    });
    const studentUserId = user.rows[0]?.id ?? '';

    const enrollment = await pool.query(
      `SELECT id FROM enrollments WHERE class_id = $1 AND student_user_id = $2 AND unenrolled_at IS NULL`,
      [classId, studentUserId],
    );
    expect(enrollment.rowCount).toBe(1);

    const registration = await pool.query<{
      status: string;
      reviewed_by: string | null;
      created_user_id: string | null;
    }>(
      `SELECT status, reviewed_by, created_user_id FROM student_registrations WHERE id = $1`,
      [registrationId],
    );
    expect(registration.rows[0]).toMatchObject({
      status: 'approved',
      reviewed_by: adminId,
      created_user_id: studentUserId,
    });

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity_id = $1 AND action = 'admin.registration_approve'`,
      [registrationId],
    );
    expect(audit.rowCount).toBe(1);

    const student = new ApiSession();
    await student.bootstrap();
    const login = await student.login(email('one'), PASSWORD);
    expect(login.status).toBe(200);
  });

  it('reports an already-reviewed request per item instead of failing the batch', async () => {
    const admin = await loginAs(adminEmail);
    const pool = getPool();

    const reviewed = await pool.query<{ id: string }>(
      `SELECT id FROM student_registrations WHERE email = $1 AND status = 'approved'`,
      [email('one')],
    );
    const res = await admin.post('/api/admin/registrations/approve', {
      ids: [reviewed.rows[0]?.id],
    });
    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(0);
    expect(res.body.results[0].ok).toBe(false);
    expect(res.body.results[0].error).toMatch(/already reviewed/);
  });

  it('bulk-approves and reports one conflicting register number per item', async () => {
    const publicSession = new ApiSession();
    await publicSession.bootstrap();

    const good = await submitRegistration(publicSession, {
      email: email('bulk-good'),
      registerNumber: `REG-${runId}-10`,
    });
    expect(good.status).toBe(201);

    // Same register number as the already-approved student: approval must fail.
    const conflicting = await submitRegistration(publicSession, {
      email: email('bulk-conflict'),
      registerNumber: `REG-${runId}-1`,
    });
    expect(conflicting.status).toBe(201);

    const admin = await loginAs(adminEmail);
    const res = await admin.post('/api/admin/registrations/approve', {
      ids: [good.body.registration.id, conflicting.body.registration.id],
    });
    expect(res.status).toBe(200);
    expect(res.body.approved).toBe(1);
    expect(res.body.failed).toBe(1);

    const results = res.body.results as Array<{ id: string; ok: boolean; error?: string }>;
    const failed = results.find((entry) => entry.id === conflicting.body.registration.id);
    const succeeded = results.find((entry) => entry.id === good.body.registration.id);
    expect(succeeded?.ok).toBe(true);
    expect(failed?.ok).toBe(false);
    expect(failed?.error).toMatch(/register number/);

    // The failed request stays pending so it can be corrected or rejected.
    const pool = getPool();
    const stillPending = await pool.query<{ status: string }>(
      `SELECT status FROM student_registrations WHERE id = $1`,
      [conflicting.body.registration.id],
    );
    expect(stillPending.rows[0]?.status).toBe('pending');
  });

  it('rejects a request and allows a corrected resubmission', async () => {
    const publicSession = new ApiSession();
    await publicSession.bootstrap();

    const first = await submitRegistration(publicSession, {
      email: email('redo'),
      registerNumber: `REG-${runId}-20`,
    });
    expect(first.status).toBe(201);

    const admin = await loginAs(adminEmail);
    const rejected = await admin.post('/api/admin/registrations/reject', {
      ids: [first.body.registration.id],
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.rejected).toBe(1);

    const pool = getPool();
    const row = await pool.query<{ status: string; reviewed_by: string | null }>(
      `SELECT status, reviewed_by FROM student_registrations WHERE id = $1`,
      [first.body.registration.id],
    );
    expect(row.rows[0]).toMatchObject({ status: 'rejected', reviewed_by: adminId });

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE entity_id = $1 AND action = 'admin.registration_reject'`,
      [first.body.registration.id],
    );
    expect(audit.rowCount).toBe(1);

    // The partial unique indexes only cover pending rows: the student may
    // register again with the same (now corrected/fixed) details.
    const second = await submitRegistration(publicSession, {
      email: email('redo'),
      registerNumber: `REG-${runId}-20`,
    });
    expect(second.status).toBe(201);
  });
});
