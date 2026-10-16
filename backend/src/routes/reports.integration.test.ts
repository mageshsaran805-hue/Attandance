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
 * Phase 5 reporting and hardening against a real database: faculty class
 * reports, HOD department reports (scoped), admin system report, student
 * history, the admin audit view with filters/paging, and the per-student
 * rate limit on failed self-marking attempts.
 *
 * Runs only when TEST_DATABASE_URL is set (see src/test/setup.ts) and cleans
 * up every row it creates. Attendance data is inserted directly so the
 * settled percentages are fully deterministic.
 */

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const app = createApp();

const CSRF_COOKIE = 'ca_session_csrf';
const PASSWORD = 'Integration-Passw0rd!';
const runId = randomUUID().slice(0, 8);

const email = (label: string) => `it-rpt-${label}-${runId}@example.test`;

const adminEmail = email('adm');
const hodAEmail = email('hoda');
const hodBEmail = email('hodb');
const facultyAEmail = email('faca');
const facultyBEmail = email('facb');
const student1Email = email('stu1');
const student2Email = email('stu2');
const student3Email = email('stu3');
const student4Email = email('stu4');
const studentBEmail = email('stub');
const limiterEmail = email('stul');

const deptACode = `RA${runId.slice(0, 4)}`;
const deptBCode = `RB${runId.slice(0, 4)}`;

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
}

async function loginAs(targetEmail: string): Promise<ApiSession> {
  const session = new ApiSession();
  await session.bootstrap();
  const res = await session.login(targetEmail, PASSWORD);
  expect(res.status).toBe(200);
  return session;
}

describe.skipIf(!enabled)('reports integration (real database)', () => {
  let adminId = '';
  let hodAId = '';
  let hodBId = '';
  let facultyAId = '';
  let facultyBId = '';
  let student1Id = '';
  let student2Id = '';
  let student3Id = '';
  let student4Id = '';
  let studentBId = '';
  let limiterId = '';
  let deptAId = '';
  let deptBId = '';
  let classA1Id = '';
  let classA2Id = '';
  let classB1Id = '';
  let openSessionA1Id = '';

  const today = todayInTimeZone();
  const day = (offset: number) => shiftDate(today, offset);

  beforeAll(async () => {
    const pool = getPool();
    await runMigrations(pool, defaultMigrationsDir());

    const passwordHash = await hashPassword(PASSWORD);
    const users = await pool.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash, full_name, role, is_active) VALUES
         ($1, $12, 'RPT Admin', 'admin', true),
         ($2, $12, 'RPT Hod A', 'hod', true),
         ($3, $12, 'RPT Hod B', 'hod', true),
         ($4, $12, 'RPT Faculty A', 'faculty', true),
         ($5, $12, 'RPT Faculty B', 'faculty', true),
         ($6, $12, 'RPT Student One', 'student', true),
         ($7, $12, 'RPT Student Two', 'student', true),
         ($8, $12, 'RPT Student Three', 'student', true),
         ($9, $12, 'RPT Student Four', 'student', true),
         ($10, $12, 'RPT Student B', 'student', true),
         ($11, $12, 'RPT Student Limiter', 'student', true)
       RETURNING id, email`,
      [
        adminEmail,
        hodAEmail,
        hodBEmail,
        facultyAEmail,
        facultyBEmail,
        student1Email,
        student2Email,
        student3Email,
        student4Email,
        studentBEmail,
        limiterEmail,
        passwordHash,
      ],
    );
    const byEmail = new Map(users.rows.map((row) => [row.email, row.id]));
    adminId = byEmail.get(adminEmail) ?? '';
    hodAId = byEmail.get(hodAEmail) ?? '';
    hodBId = byEmail.get(hodBEmail) ?? '';
    facultyAId = byEmail.get(facultyAEmail) ?? '';
    facultyBId = byEmail.get(facultyBEmail) ?? '';
    student1Id = byEmail.get(student1Email) ?? '';
    student2Id = byEmail.get(student2Email) ?? '';
    student3Id = byEmail.get(student3Email) ?? '';
    student4Id = byEmail.get(student4Email) ?? '';
    studentBId = byEmail.get(studentBEmail) ?? '';
    limiterId = byEmail.get(limiterEmail) ?? '';

    const departments = await pool.query<{ id: string; code: string }>(
      `INSERT INTO departments (name, code, hod_user_id) VALUES
         ($1, $3, $5),
         ($2, $4, $6)
       RETURNING id, code`,
      [`RPT Dept A ${runId}`, `RPT Dept B ${runId}`, deptACode, deptBCode, hodAId, hodBId],
    );
    const deptByCode = new Map(departments.rows.map((row) => [row.code, row.id]));
    deptAId = deptByCode.get(deptACode) ?? '';
    deptBId = deptByCode.get(deptBCode) ?? '';

    const classes = await pool.query<{ id: string; name: string }>(
      `INSERT INTO classes (department_id, name, academic_year) VALUES
         ($1, $3, '2026-27'),
         ($1, $4, '2026-27'),
         ($2, $5, '2026-27')
       RETURNING id, name`,
      [deptAId, deptBId, `RPT Class A1 ${runId}`, `RPT Class A2 ${runId}`, `RPT Class B1 ${runId}`],
    );
    const classByName = new Map(classes.rows.map((row) => [row.name, row.id]));
    classA1Id = classByName.get(`RPT Class A1 ${runId}`) ?? '';
    classA2Id = classByName.get(`RPT Class A2 ${runId}`) ?? '';
    classB1Id = classByName.get(`RPT Class B1 ${runId}`) ?? '';

    await pool.query(
      `INSERT INTO enrollments (class_id, student_user_id) VALUES
         ($1, $4), ($1, $5), ($1, $6), ($2, $7), ($3, $8)`,
      [classA1Id, classA2Id, classB1Id, student1Id, student2Id, student3Id, student4Id, studentBId],
    );
    await pool.query(
      `INSERT INTO class_faculty (class_id, faculty_user_id, assigned_by) VALUES
         ($1, $3, $5), ($2, $4, $5)`,
      [classA1Id, classB1Id, facultyAId, facultyBId, adminId],
    );

    // classA1: three closed sessions (all settled) plus today's open session.
    // classB1: one closed session. classA2: no sessions at all.
    const sessions = await pool.query<{ id: string; session_date: string; class_id: string }>(
      `INSERT INTO attendance_sessions (class_id, session_date, status, started_by, closed_by, closed_at) VALUES
         ($1, $2, 'closed', $4, $4, now()),
         ($1, $3, 'closed', $4, $4, now()),
         ($1, $5, 'closed', $4, $4, now()),
         ($6, $2, 'closed', $7, $7, now()),
         ($1, $8, 'open', $4, NULL, NULL)
       RETURNING id, session_date::text, class_id`,
      [classA1Id, day(-10), day(-5), facultyAId, day(-3), classB1Id, facultyBId, today],
    );
    const sessionKey = (classId: string, date: string) => `${classId}:${date}`;
    const sessionByKey = new Map(
      sessions.rows.map((row) => [sessionKey(row.class_id, row.session_date), row.id]),
    );
    const sessionId = (classId: string, date: string): string => {
      const id = sessionByKey.get(sessionKey(classId, date));
      expect(id).toBeTruthy();
      return id ?? '';
    };

    const a1d10 = sessionId(classA1Id, day(-10));
    const a1d5 = sessionId(classA1Id, day(-5));
    const a1d3 = sessionId(classA1Id, day(-3));
    const b1d10 = sessionId(classB1Id, day(-10));
    openSessionA1Id = sessionId(classA1Id, today);

    // Present/absent mix: s1 3/0, s2 1/2, s3 1/2 -> 5 present, 4 absent (55.6%).
    await pool.query(
      `INSERT INTO attendance_records (session_id, student_user_id, status, method, marked_by) VALUES
         ($1, $2, 'present', 'otp', NULL),
         ($1, $3, 'present', 'otp', NULL),
         ($1, $4, 'absent', 'manual', $5),
         ($6, $2, 'present', 'otp', NULL),
         ($6, $3, 'absent', 'manual', $5),
         ($6, $4, 'absent', 'manual', $5),
         ($7, $2, 'present', 'otp', NULL),
         ($7, $3, 'absent', 'manual', $5),
         ($7, $4, 'present', 'otp', NULL),
         ($8, $9, 'present', 'otp', NULL)`,
      [a1d10, student1Id, student2Id, student3Id, facultyAId, a1d5, a1d3, b1d10, studentBId],
    );

    // Two audit probes for the admin audit view.
    await pool.query(
      `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, old_value, new_value, ip) VALUES
         ($1, 'qa.audit_probe', 'qa_probe', 'probe-1', '{"n":1}'::jsonb, '{"n":2}'::jsonb, '203.0.113.7'),
         ($2, 'qa.audit_probe', 'qa_probe', 'probe-2', NULL, NULL, NULL)`,
      [adminId, hodAId],
    );

    for (const id of [
      adminId, hodAId, hodBId, facultyAId, facultyBId, student1Id, student2Id,
      student3Id, student4Id, studentBId, limiterId, deptAId, deptBId,
      classA1Id, classA2Id, classB1Id,
    ]) {
      expect(id).not.toBe('');
    }
  });

  afterAll(async () => {
    const pool = getPool();
    const userIds = [adminId, hodAId, hodBId, facultyAId, facultyBId, student1Id, student2Id, student3Id, student4Id, studentBId, limiterId].filter(Boolean);
    const classIds = [classA1Id, classA2Id, classB1Id].filter(Boolean);
    const deptIds = [deptAId, deptBId].filter(Boolean);

    await pool.query('BEGIN');
    await pool.query(`DELETE FROM audit_log WHERE entity_type = 'qa_probe'`);
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
    await pool.query('UPDATE departments SET hod_user_id = NULL WHERE id = ANY($1::uuid[])', [deptIds]);
    await pool.query('DELETE FROM departments WHERE id = ANY($1::uuid[])', [deptIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    await pool.query('COMMIT');
    await closePool();
  });

  it('serves the faculty class report with settled-only percentages', async () => {
    const facultyA = await loginAs(facultyAEmail);

    const res = await facultyA.get(`/api/faculty/classes/${classA1Id}/report`);
    expect(res.status).toBe(200);
    expect(res.body.class.id).toBe(classA1Id);
    expect(res.body.from).toBe(day(-29));
    expect(res.body.to).toBe(today);
    expect(res.body.totals).toEqual({
      sessions: 4,
      settledSessions: 3,
      present: 5,
      absent: 4,
      percentage: 55.6,
    });

    const students = new Map(
      (res.body.students as Array<{ studentUserId: string }>).map((row) => [row.studentUserId, row]),
    );
    expect(res.body.students).toHaveLength(3);
    expect(students.get(student1Id)).toMatchObject({ present: 3, absent: 0, percentage: 100 });
    expect(students.get(student2Id)).toMatchObject({ present: 1, absent: 2, percentage: 33.3 });
    expect(students.get(student3Id)).toMatchObject({ present: 1, absent: 2, percentage: 33.3 });

    expect(res.body.sessions).toHaveLength(4);
    const todayRow = res.body.sessions.find((row: { sessionDate: string }) => row.sessionDate === today);
    expect(todayRow).toMatchObject({ status: 'open', present: 0, absent: 0, pending: 3 });

    // Out-of-scope faculty get a 404; students cannot call the report at all.
    const facultyB = await loginAs(facultyBEmail);
    expect((await facultyB.get(`/api/faculty/classes/${classA1Id}/report`)).status).toBe(404);
    const student1 = await loginAs(student1Email);
    expect((await student1.get(`/api/faculty/classes/${classA1Id}/report`)).status).toBe(403);
    expect((await student1.get('/api/admin/reports/attendance')).status).toBe(403);
  });

  it('filters the faculty report by date range and validates input', async () => {
    const facultyA = await loginAs(facultyAEmail);
    const path = `/api/faculty/classes/${classA1Id}/report`;

    const windowed = await facultyA.get(`${path}?from=${day(-6)}&to=${day(-4)}`);
    expect(windowed.status).toBe(200);
    expect(windowed.body.totals).toEqual({
      sessions: 1,
      settledSessions: 1,
      present: 1,
      absent: 2,
      percentage: 33.3,
    });
    const windowedStudents = new Map(
      (windowed.body.students as Array<{ studentUserId: string }>).map((row) => [row.studentUserId, row]),
    );
    expect(windowedStudents.get(student1Id)).toMatchObject({ present: 1, absent: 0, percentage: 100 });
    expect(windowedStudents.get(student2Id)).toMatchObject({ present: 0, absent: 1, percentage: 0 });

    // Today only: the open session is listed but nothing is settled yet.
    const todayOnly = await facultyA.get(`${path}?from=${today}&to=${today}`);
    expect(todayOnly.status).toBe(200);
    expect(todayOnly.body.totals).toEqual({
      sessions: 1,
      settledSessions: 0,
      present: 0,
      absent: 0,
      percentage: null,
    });

    expect((await facultyA.get(`${path}?from=${today}&to=${day(-1)}`)).status).toBe(400);
    expect((await facultyA.get(`${path}?from=2026-02-31&to=${today}`)).status).toBe(400);
    expect((await facultyA.get(`${path}?from=${day(-400)}&to=${today}`)).status).toBe(400);
  });

  it('serves department reports scoped to the HOD', async () => {
    const hodA = await loginAs(hodAEmail);
    const department = await hodA.get('/api/hod/reports/attendance');
    expect(department.status).toBe(200);
    expect(department.body.department.code).toBe(deptACode);
    expect(department.body.totals).toEqual({
      sessions: 4,
      settledSessions: 3,
      present: 5,
      absent: 4,
      percentage: 55.6,
    });

    const classA1 = department.body.classes.find((row: { classId: string }) => row.classId === classA1Id);
    expect(classA1).toMatchObject({ studentCount: 3, percentage: 55.6 });
    const classA2 = department.body.classes.find((row: { classId: string }) => row.classId === classA2Id);
    expect(classA2).toMatchObject({ studentCount: 1, sessions: 0, percentage: null });
    expect(
      department.body.classes.some((row: { classId: string }) => row.classId === classB1Id),
    ).toBe(false);

    // Class drill-down within the department works; another department's class is a 404.
    const classReport = await hodA.get(`/api/hod/classes/${classA1Id}/report`);
    expect(classReport.status).toBe(200);
    expect(classReport.body.totals.percentage).toBe(55.6);
    expect((await hodA.get(`/api/hod/classes/${classB1Id}/report`)).status).toBe(404);

    // HOD B only sees department B.
    const hodB = await loginAs(hodBEmail);
    const departmentB = await hodB.get('/api/hod/reports/attendance');
    expect(departmentB.status).toBe(200);
    expect(departmentB.body.department.code).toBe(deptBCode);
    expect(departmentB.body.totals).toEqual({
      sessions: 1,
      settledSessions: 1,
      present: 1,
      absent: 0,
      percentage: 100,
    });

    // Faculty cannot read HOD reports.
    const facultyA = await loginAs(facultyAEmail);
    expect((await facultyA.get('/api/hod/reports/attendance')).status).toBe(403);
  });

  it('serves the system-wide report to admins only', async () => {
    const admin = await loginAs(adminEmail);
    const res = await admin.get('/api/admin/reports/attendance');
    expect(res.status).toBe(200);

    // Other suites may add attendance while this one runs, so system-wide
    // totals are bounded rather than exact; this suite's entries must match.
    expect(res.body.totals.present).toBeGreaterThanOrEqual(6);
    expect(res.body.totals.absent).toBeGreaterThanOrEqual(4);
    expect(res.body.totals.settledSessions).toBeGreaterThanOrEqual(4);

    const departmentA = res.body.departments.find(
      (row: { departmentId: string }) => row.departmentId === deptAId,
    );
    expect(departmentA).toMatchObject({ classCount: 2, studentCount: 4, percentage: 55.6 });
    const departmentB = res.body.departments.find(
      (row: { departmentId: string }) => row.departmentId === deptBId,
    );
    expect(departmentB).toMatchObject({ classCount: 1, studentCount: 1, percentage: 100 });

    const classB1 = res.body.classes.find((row: { classId: string }) => row.classId === classB1Id);
    expect(classB1).toMatchObject({ percentage: 100 });
    expect(classB1.department.code).toBe(deptBCode);

    const hodA = await loginAs(hodAEmail);
    expect((await hodA.get('/api/admin/reports/attendance')).status).toBe(403);
  });

  it('serves a student only their own attendance history', async () => {
    const student1 = await loginAs(student1Email);
    const res = await student1.get('/api/student/attendance/history');
    expect(res.status).toBe(200);
    expect(res.body.totals).toEqual({
      sessions: 4,
      settledSessions: 3,
      present: 3,
      absent: 0,
      percentage: 100,
    });

    const byDate = new Map(
      (res.body.sessions as Array<{ sessionDate: string }>).map((row) => [row.sessionDate, row]),
    );
    expect(byDate.size).toBe(4);
    expect(byDate.get(today)).toMatchObject({
      sessionStatus: 'open',
      status: null,
      method: null,
      markedAt: null,
      classId: classA1Id,
    });
    expect(byDate.get(day(-5))).toMatchObject({
      sessionStatus: 'closed',
      status: 'present',
      method: 'otp',
    });

    const student2 = await loginAs(student2Email);
    const res2 = await student2.get('/api/student/attendance/history');
    expect(res2.body.totals).toEqual({
      sessions: 4,
      settledSessions: 3,
      present: 1,
      absent: 2,
      percentage: 33.3,
    });

    // A student with no sessions at all gets an empty, honest report.
    const student4 = await loginAs(student4Email);
    const res4 = await student4.get('/api/student/attendance/history');
    expect(res4.body.totals).toEqual({
      sessions: 0,
      settledSessions: 0,
      present: 0,
      absent: 0,
      percentage: null,
    });

    // A class B student never sees class A sessions.
    const studentB = await loginAs(studentBEmail);
    const resB = await studentB.get('/api/student/attendance/history');
    expect(resB.body.totals).toEqual({
      sessions: 1,
      settledSessions: 1,
      present: 1,
      absent: 0,
      percentage: 100,
    });
    expect(resB.body.sessions[0]).toMatchObject({ classId: classB1Id, status: 'present' });
  });

  it('lists the audit trail for admins with filters and paging', async () => {
    const admin = await loginAs(adminEmail);

    const list = await admin.get('/api/admin/audit?action=qa.audit_probe');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(2);
    expect(list.body.entries).toHaveLength(2);
    expect(Number(list.body.entries[0].id)).toBeGreaterThan(Number(list.body.entries[1].id));

    const withValues = list.body.entries.find(
      (entry: { entityId: string }) => entry.entityId === 'probe-1',
    );
    expect(withValues.actor.email).toBe(adminEmail);
    expect(withValues.oldValue).toEqual({ n: 1 });
    expect(withValues.newValue).toEqual({ n: 2 });
    expect(withValues.ip).toBe('203.0.113.7');
    const withoutActorValues = list.body.entries.find(
      (entry: { entityId: string }) => entry.entityId === 'probe-2',
    );
    expect(withoutActorValues.actor.email).toBe(hodAEmail);
    expect(withoutActorValues.oldValue).toBeNull();

    const byActor = await admin.get(
      `/api/admin/audit?action=qa.audit_probe&actorEmail=${encodeURIComponent(hodAEmail)}`,
    );
    expect(byActor.body.total).toBe(1);
    expect(byActor.body.entries[0].entityId).toBe('probe-2');

    const page1 = await admin.get('/api/admin/audit?action=qa.audit_probe&limit=1&page=1');
    const page2 = await admin.get('/api/admin/audit?action=qa.audit_probe&limit=1&page=2');
    expect(page1.body.total).toBe(2);
    expect(page1.body.entries).toHaveLength(1);
    expect(page2.body.entries).toHaveLength(1);
    expect(page1.body.entries[0].id).not.toBe(page2.body.entries[0].id);

    const todayOnly = await admin.get(
      `/api/admin/audit?action=qa.audit_probe&from=${today}&to=${today}`,
    );
    expect(todayOnly.body.total).toBe(2);
    const futureOnly = await admin.get(
      `/api/admin/audit?action=qa.audit_probe&from=${day(1)}&to=${day(1)}`,
    );
    expect(futureOnly.body.total).toBe(0);

    const byEntity = await admin.get('/api/admin/audit?entityType=qa_probe');
    expect(byEntity.body.total).toBe(2);
    const actions = await admin.get('/api/admin/audit/actions');
    expect(actions.body.actions).toContain('qa.audit_probe');

    const facultyA = await loginAs(facultyAEmail);
    expect((await facultyA.get('/api/admin/audit')).status).toBe(403);
    expect((await admin.get('/api/admin/audit?page=0')).status).toBe(400);
    expect((await admin.get('/api/admin/audit?from=2026-13-01')).status).toBe(400);
    expect((await admin.get(`/api/admin/audit?from=${today}&to=${day(-1)}`)).status).toBe(400);
  });

  it('rate-limits repeated failed self-marking attempts per student', async () => {
    const limiterStudent = await loginAs(limiterEmail);
    const path = `/api/student/sessions/${openSessionA1Id}/mark`;

    // The limiter student is not enrolled, so every attempt is a 404 — which
    // counts as a failure for the limiter. The 31st attempt hits the cap.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 31; attempt += 1) {
      const res = await limiterStudent.post(path, { otp: '123456' });
      statuses.push(res.status);
      if (attempt === 30) {
        expect(res.body.error).toContain('Too many attendance marking attempts');
      }
    }

    expect(statuses.slice(0, 30).every((status) => status === 404)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});
