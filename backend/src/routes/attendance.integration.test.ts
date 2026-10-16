import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { defaultMigrationsDir, runMigrations } from '../db/migrate.js';
import { closePool, getPool } from '../db/pool.js';
import { hashOtp } from '../lib/otp.js';
import { hashPassword } from '../lib/password.js';
import { todayInTimeZone } from '../lib/time.js';
import { cookieHeaderFrom, cookieValue } from '../test/helpers.js';

/**
 * Phase 4 attendance flows against a real database: opening the daily session
 * with an OTP, student self-marking (wrong/expired/locked codes), OTP
 * regeneration, manual marks and corrections, and closing with absent
 * materialization. Also checks that OTP values never reach the audit trail.
 *
 * Runs only when TEST_DATABASE_URL is set (see src/test/setup.ts) and cleans
 * up every row it creates.
 */

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const app = createApp();

const CSRF_COOKIE = 'ca_session_csrf';
const PASSWORD = 'Integration-Passw0rd!';
const runId = randomUUID().slice(0, 8);

const email = (label: string) => `it-att-${label}-${runId}@example.test`;

const adminEmail = email('adm');
const faculty1Email = email('fac1');
const faculty2Email = email('fac2');
const student1Email = email('stu1');
const student2Email = email('stu2');
const student3Email = email('stu3');
const student4Email = email('stu4');
const student5Email = email('stu5');

const wrongOtp = (otp: string) => (otp === '000000' ? '999999' : '000000');

/** Small cookie/CSRF-aware API client. */
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

describe.skipIf(!enabled)('attendance integration (real database)', () => {
  const created = { userIds: [] as string[] };

  let adminId = '';
  let faculty1Id = '';
  let faculty2Id = '';
  let student1Id = '';
  let student2Id = '';
  let student3Id = '';
  let student4Id = '';
  let student5Id = '';
  let deptId = '';
  let classAId = '';
  let classBId = '';

  // Shared state across the sequential scenarios.
  let sessionId = '';
  let otp1 = '';
  let otp3 = '';

  beforeAll(async () => {
    const pool = getPool();
    await runMigrations(pool, defaultMigrationsDir());

    const passwordHash = await hashPassword(PASSWORD);
    const users = await pool.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash, full_name, role, is_active) VALUES
         ($1, $9, 'IT Admin', 'admin', true),
         ($2, $9, 'IT Faculty One', 'faculty', true),
         ($3, $9, 'IT Faculty Two', 'faculty', true),
         ($4, $9, 'IT Student One', 'student', true),
         ($5, $9, 'IT Student Two', 'student', true),
         ($6, $9, 'IT Student Three', 'student', true),
         ($7, $9, 'IT Student Four', 'student', true),
         ($8, $9, 'IT Student Five', 'student', true)
       RETURNING id, email`,
      [
        adminEmail,
        faculty1Email,
        faculty2Email,
        student1Email,
        student2Email,
        student3Email,
        student4Email,
        student5Email,
        passwordHash,
      ],
    );
    const byEmail = new Map(users.rows.map((row) => [row.email, row.id]));
    adminId = byEmail.get(adminEmail) ?? '';
    faculty1Id = byEmail.get(faculty1Email) ?? '';
    faculty2Id = byEmail.get(faculty2Email) ?? '';
    student1Id = byEmail.get(student1Email) ?? '';
    student2Id = byEmail.get(student2Email) ?? '';
    student3Id = byEmail.get(student3Email) ?? '';
    student4Id = byEmail.get(student4Email) ?? '';
    student5Id = byEmail.get(student5Email) ?? '';

    const departments = await pool.query<{ id: string }>(
      `INSERT INTO departments (name, code) VALUES ($1, $2) RETURNING id`,
      [`IT QA Attendance Dept ${runId}`, `A${runId.slice(0, 4)}`],
    );
    deptId = departments.rows[0]?.id ?? '';

    const classes = await pool.query<{ id: string; name: string }>(
      `INSERT INTO classes (department_id, name, academic_year) VALUES
         ($1, $2, '2026-27'),
         ($1, $3, '2026-27')
       RETURNING id, name`,
      [deptId, `IT QA Att Class A ${runId}`, `IT QA Att Class B ${runId}`],
    );
    const classByName = new Map(classes.rows.map((row) => [row.name, row.id]));
    classAId = classByName.get(`IT QA Att Class A ${runId}`) ?? '';
    classBId = classByName.get(`IT QA Att Class B ${runId}`) ?? '';

    await pool.query(
      `INSERT INTO enrollments (class_id, student_user_id) VALUES
         ($1, $3), ($1, $4), ($1, $5), ($1, $6), ($2, $7)`,
      [classAId, classBId, student1Id, student2Id, student3Id, student4Id, student5Id],
    );
    await pool.query(
      `INSERT INTO class_faculty (class_id, faculty_user_id, assigned_by) VALUES ($1, $2, $3)`,
      [classAId, faculty1Id, adminId],
    );

    for (const id of [adminId, faculty1Id, faculty2Id, student1Id, student2Id, student3Id, student4Id, student5Id, deptId, classAId, classBId]) {
      expect(id).not.toBe('');
    }
  });

  afterAll(async () => {
    const pool = getPool();
    const userIds = [adminId, faculty1Id, faculty2Id, student1Id, student2Id, student3Id, student4Id, student5Id, ...created.userIds].filter(Boolean);
    const classIds = [classAId, classBId].filter(Boolean);
    const deptIds = [deptId].filter(Boolean);

    await pool.query('BEGIN');
    await pool.query('DELETE FROM audit_log WHERE actor_user_id = ANY($1::uuid[])', [userIds]);
    await pool.query(
      `DELETE FROM otp_attempts
        WHERE session_id IN (SELECT id FROM attendance_sessions WHERE class_id = ANY($1::uuid[]))`,
      [classIds],
    );
    await pool.query(
      `DELETE FROM attendance_records
        WHERE session_id IN (SELECT id FROM attendance_sessions WHERE class_id = ANY($1::uuid[]))`,
      [classIds],
    );
    await pool.query('DELETE FROM attendance_sessions WHERE class_id = ANY($1::uuid[])', [classIds]);
    await pool.query('DELETE FROM enrollments WHERE class_id = ANY($1::uuid[])', [classIds]);
    await pool.query('DELETE FROM class_faculty WHERE class_id = ANY($1::uuid[])', [classIds]);
    await pool.query('DELETE FROM classes WHERE id = ANY($1::uuid[])', [classIds]);
    await pool.query('DELETE FROM departments WHERE id = ANY($1::uuid[])', [deptIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    await pool.query('COMMIT');
    await closePool();
  });

  it('opens today’s session with a one-time OTP and rejects duplicates', async () => {
    const faculty1 = await loginAs(faculty1Email);

    const before = await faculty1.get(`/api/faculty/classes/${classAId}/sessions`);
    expect(before.status).toBe(200);
    expect(before.body.today).toBeNull();
    expect(before.body.recent).toEqual([]);

    const outOfScope = await (await loginAs(faculty2Email)).post(
      `/api/faculty/classes/${classAId}/sessions`,
    );
    expect(outOfScope.status).toBe(404);

    const opened = await faculty1.post(`/api/faculty/classes/${classAId}/sessions`);
    expect(opened.status).toBe(201);
    otp1 = opened.body.otp as string;
    expect(otp1).toMatch(/^\d{6}$/);
    sessionId = opened.body.session.id as string;
    expect(opened.body.session.status).toBe('open');
    expect(opened.body.session.sessionDate).toBe(todayInTimeZone());
    expect(opened.body.session.otpActive).toBe(true);
    expect(opened.body.session.counts).toEqual({ enrolled: 4, present: 0, absent: 0, pending: 4 });
    // The raw OTP is returned once; the database only keeps the HMAC hash.
    expect(opened.body.session).not.toHaveProperty('otp');

    const duplicate = await faculty1.post(`/api/faculty/classes/${classAId}/sessions`);
    expect(duplicate.status).toBe(409);

    const pool = getPool();
    const stored = await pool.query<{ otp_hash: string }>(
      'SELECT otp_hash FROM attendance_sessions WHERE id = $1',
      [sessionId],
    );
    expect(stored.rows[0]?.otp_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.rows[0]?.otp_hash).not.toBe(otp1);
    expect(stored.rows[0]?.otp_hash).toBe(hashOtp(otp1));

    const audit = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_log
        WHERE action = 'session.open' AND entity_id = $1`,
      [sessionId],
    );
    expect(audit.rows[0]?.count).toBe(1);

    // Students cannot read the faculty session view.
    const student1 = await loginAs(student1Email);
    const denied = await student1.get(`/api/faculty/sessions/${sessionId}`);
    expect(denied.status).toBe(403);
  });

  it('scopes session access to assigned faculty only', async () => {
    const faculty2 = await loginAs(faculty2Email);
    expect((await faculty2.get(`/api/faculty/sessions/${sessionId}`)).status).toBe(404);
    expect((await faculty2.post(`/api/faculty/sessions/${sessionId}/otp`)).status).toBe(404);
    expect(
      (await faculty2.post(`/api/faculty/sessions/${sessionId}/mark`, {
        studentUserId: student1Id,
        status: 'present',
      })).status,
    ).toBe(404);
    expect((await faculty2.post(`/api/faculty/sessions/${sessionId}/close`)).status).toBe(404);
  });

  it('lets the student see today’s session and self-mark with the OTP', async () => {
    const student1 = await loginAs(student1Email);

    const today = await student1.get('/api/student/attendance/today');
    expect(today.status).toBe(200);
    expect(today.body.date).toBe(todayInTimeZone());
    expect(today.body.classes).toHaveLength(1);
    expect(today.body.classes[0].class.id).toBe(classAId);
    expect(today.body.classes[0].session.id).toBe(sessionId);
    expect(today.body.classes[0].session.otpActive).toBe(true);
    expect(today.body.classes[0].record).toBeNull();

    const wrong = await student1.post(`/api/student/sessions/${sessionId}/mark`, {
      otp: wrongOtp(otp1),
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.attemptsRemaining).toBe(4);

    const malformed = await student1.post(`/api/student/sessions/${sessionId}/mark`, { otp: 'abc' });
    expect(malformed.status).toBe(400);

    const missing = await student1.post(`/api/student/sessions/${randomUUID()}/mark`, {
      otp: otp1,
    });
    expect(missing.status).toBe(404);

    const marked = await student1.post(`/api/student/sessions/${sessionId}/mark`, { otp: otp1 });
    expect(marked.status).toBe(201);
    expect(marked.body.record.status).toBe('present');
    expect(marked.body.record.method).toBe('otp');
    expect(marked.body.record.markedByUserId).toBeNull();

    const again = await student1.post(`/api/student/sessions/${sessionId}/mark`, { otp: otp1 });
    expect(again.status).toBe(409);
    expect(again.body.error).toMatch(/already recorded/);

    // A student of another class cannot mark this session (no existence leak).
    const student5 = await loginAs(student5Email);
    const foreign = await student5.post(`/api/student/sessions/${sessionId}/mark`, { otp: otp1 });
    expect(foreign.status).toBe(404);
  });

  it('rejects expired OTPs, locks out repeated failures and resets on regeneration', async () => {
    const student2 = await loginAs(student2Email);
    const faculty1 = await loginAs(faculty1Email);
    const pool = getPool();

    // Expired OTPs are rejected without counting a failed attempt.
    await pool.query(
      `UPDATE attendance_sessions SET otp_expires_at = now() - interval '1 minute' WHERE id = $1`,
      [sessionId],
    );
    const expired = await student2.post(`/api/student/sessions/${sessionId}/mark`, { otp: otp1 });
    expect(expired.status).toBe(409);
    expect(expired.body.error).toMatch(/expired/);

    const regenerated = await faculty1.post(`/api/faculty/sessions/${sessionId}/otp`);
    expect(regenerated.status).toBe(200);
    const otp2 = regenerated.body.otp as string;
    expect(otp2).toMatch(/^\d{6}$/);
    otp3 = otp2;

    // The old code is invalid after regeneration and failures are counted
    // from scratch (the user had none against the fresh code yet).
    const oldCode = await student2.post(`/api/student/sessions/${sessionId}/mark`, { otp: otp1 });
    expect(oldCode.status).toBe(400);
    expect(oldCode.body.attemptsRemaining).toBe(4);

    for (const expectedRemaining of [3, 2, 1]) {
      const attempt = await student2.post(`/api/student/sessions/${sessionId}/mark`, {
        otp: wrongOtp(otp2),
      });
      expect(attempt.status).toBe(400);
      expect(attempt.body.attemptsRemaining).toBe(expectedRemaining);
    }
    const lockedOut = await student2.post(`/api/student/sessions/${sessionId}/mark`, {
      otp: wrongOtp(otp2),
    });
    expect(lockedOut.status).toBe(429);

    // Even the correct code is refused while locked out.
    const lockedWithCorrect = await student2.post(`/api/student/sessions/${sessionId}/mark`, {
      otp: otp2,
    });
    expect(lockedWithCorrect.status).toBe(429);

    // Regeneration resets the lockout and invalidates the previous code.
    const regeneratedAgain = await faculty1.post(`/api/faculty/sessions/${sessionId}/otp`);
    expect(regeneratedAgain.status).toBe(200);
    otp3 = regeneratedAgain.body.otp as string;

    const stale = await student2.post(`/api/student/sessions/${sessionId}/mark`, { otp: otp2 });
    expect(stale.status).toBe(400);
    expect(stale.body.attemptsRemaining).toBe(4);

    const marked = await student2.post(`/api/student/sessions/${sessionId}/mark`, { otp: otp3 });
    expect(marked.status).toBe(201);
    expect(marked.body.record.status).toBe('present');

    // A session from another day is not open for marking today.
    const yesterday = await pool.query<{ id: string }>(
      `INSERT INTO attendance_sessions (class_id, session_date, otp_hash, otp_expires_at, started_by)
       VALUES ($1, (now() AT TIME ZONE 'Asia/Kolkata')::date - 1, $2, now() + interval '10 minutes', $3)
       RETURNING id`,
      [classAId, hashOtp('424242'), faculty1Id],
    );
    const staleDate = await (await loginAs(student3Email)).post(
      `/api/student/sessions/${yesterday.rows[0]?.id}/mark`,
      { otp: '424242' },
    );
    expect(staleDate.status).toBe(409);
    expect(staleDate.body.error).toMatch(/not open for marking today/);
  });

  it('manual marks and corrections keep an audit trail', async () => {
    const faculty1 = await loginAs(faculty1Email);

    const marked = await faculty1.post(`/api/faculty/sessions/${sessionId}/mark`, {
      studentUserId: student3Id,
      status: 'absent',
    });
    expect(marked.status).toBe(200);
    expect(marked.body.record.status).toBe('absent');
    expect(marked.body.record.method).toBe('manual');
    expect(marked.body.record.markedByUserId).toBe(faculty1Id);
    const recordId = marked.body.record.id as string;

    const corrected = await faculty1.post(`/api/faculty/sessions/${sessionId}/mark`, {
      studentUserId: student3Id,
      status: 'present',
    });
    expect(corrected.status).toBe(200);
    expect(corrected.body.record.id).toBe(recordId);
    expect(corrected.body.record.status).toBe('present');

    const notEnrolled = await faculty1.post(`/api/faculty/sessions/${sessionId}/mark`, {
      studentUserId: randomUUID(),
      status: 'present',
    });
    expect(notEnrolled.status).toBe(404);

    const pool = getPool();
    const audit = await pool.query<{ old_value: unknown; new_value: unknown }>(
      `SELECT old_value, new_value FROM audit_log
        WHERE action = 'session.manual_mark' AND entity_id = $1
        ORDER BY id`,
      [recordId],
    );
    expect(audit.rows).toHaveLength(2);
    expect((audit.rows[0]?.old_value as { status?: string } | null)?.status).toBeUndefined();
    expect((audit.rows[0]?.new_value as { status?: string }).status).toBe('absent');
    expect((audit.rows[1]?.old_value as { status?: string }).status).toBe('absent');
    expect((audit.rows[1]?.new_value as { status?: string }).status).toBe('present');
  });

  it('closes the session, materializes pending students as absent and freezes OTP marking', async () => {
    const faculty1 = await loginAs(faculty1Email);

    const detailBefore = await faculty1.get(`/api/faculty/sessions/${sessionId}`);
    expect(detailBefore.status).toBe(200);
    expect(detailBefore.body.students).toHaveLength(4);
    const pendingBefore = detailBefore.body.students.filter(
      (student: { status: string | null }) => student.status === null,
    );
    expect(pendingBefore).toHaveLength(1);
    expect(pendingBefore[0].studentUserId).toBe(student4Id);

    const closed = await faculty1.post(`/api/faculty/sessions/${sessionId}/close`);
    expect(closed.status).toBe(200);
    expect(closed.body.session.status).toBe('closed');
    expect(closed.body.absentAdded).toBe(1);
    expect(closed.body.session.counts).toEqual({ enrolled: 4, present: 3, absent: 1, pending: 0 });
    expect(closed.body.session.closedByName).toBe('IT Faculty One');

    const closeAgain = await faculty1.post(`/api/faculty/sessions/${sessionId}/close`);
    expect(closeAgain.status).toBe(409);

    const regenerateClosed = await faculty1.post(`/api/faculty/sessions/${sessionId}/otp`);
    expect(regenerateClosed.status).toBe(409);

    // The materialized absent record is attributed to the closing faculty.
    const detailAfter = await faculty1.get(`/api/faculty/sessions/${sessionId}`);
    const student4Row = detailAfter.body.students.find(
      (student: { studentUserId: string }) => student.studentUserId === student4Id,
    );
    expect(student4Row.status).toBe('absent');
    expect(student4Row.method).toBe('manual');

    // Students can no longer self-mark a closed session.
    const student4 = await loginAs(student4Email);
    const late = await student4.post(`/api/student/sessions/${sessionId}/mark`, { otp: otp3 });
    expect(late.status).toBe(409);
    expect(late.body.error).toMatch(/closed/);

    // Faculty corrections stay possible after closing.
    const corrected = await faculty1.post(`/api/faculty/sessions/${sessionId}/mark`, {
      studentUserId: student4Id,
      status: 'present',
    });
    expect(corrected.status).toBe(200);
    const afterCorrection = await faculty1.get(`/api/faculty/sessions/${sessionId}`);
    expect(afterCorrection.body.session.counts).toEqual({
      enrolled: 4,
      present: 4,
      absent: 0,
      pending: 0,
    });
  });

  it('never stores OTP values or hashes in the audit trail', async () => {
    const pool = getPool();
    const codes = [otp1, otp3].filter((code) => code !== '');

    for (const code of codes) {
      const leak = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM audit_log
          WHERE actor_user_id = ANY($1::uuid[])
            AND (old_value::text ~ ('(^|[^0-9])' || $2 || '([^0-9]|$)')
              OR new_value::text ~ ('(^|[^0-9])' || $2 || '([^0-9]|$)'))`,
        [[adminId, faculty1Id, faculty2Id, student1Id, student2Id, student3Id, student4Id, student5Id], code],
      );
      expect(leak.rows[0]?.count, `OTP ${code} leaked into audit_log`).toBe(0);
    }

    const actions = await pool.query<{ action: string }>(
      `SELECT DISTINCT action FROM audit_log WHERE actor_user_id = ANY($1::uuid[])`,
      [[adminId, faculty1Id, faculty2Id, student1Id, student2Id, student3Id, student4Id, student5Id]],
    );
    const seen = new Set(actions.rows.map((row) => row.action));
    for (const expected of [
      'session.open',
      'session.otp_regenerate',
      'session.manual_mark',
      'session.close',
      'session.otp_mark',
    ]) {
      expect(seen.has(expected), `missing audit action ${expected}`).toBe(true);
    }
  });
});
