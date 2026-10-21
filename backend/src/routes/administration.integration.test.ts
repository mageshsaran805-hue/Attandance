import { randomUUID } from 'node:crypto';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { defaultMigrationsDir, runMigrations } from '../db/migrate.js';
import { closePool, getPool } from '../db/pool.js';
import { hashPassword } from '../lib/password.js';
import { cookieHeaderFrom, cookieValue } from '../test/helpers.js';

/**
 * Phase 3 administration flows against a real database: department/class/
 * account management, strict 1:1 HOD enforcement, department and faculty
 * scoping, assignment history, enrollment lifecycle, role-change guards and
 * the audit trail.
 *
 * Runs only when TEST_DATABASE_URL is set (see src/test/setup.ts) — a
 * disposable database, never the development one.
 */

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const app = createApp();

const CSRF_COOKIE = 'ca_session_csrf';
const PASSWORD = 'Integration-Passw0rd!';
const runId = randomUUID().slice(0, 8);

const email = (label: string) => `it-${label}-${runId}@example.test`;

const adminEmail = email('adm');
const hodAEmail = email('hoda');
const hodBEmail = email('hodb');
const faculty1Email = email('fac1');
const faculty2Email = email('fac2');
const student1Email = email('stu1');

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

  patch(path: string, body: unknown) {
    return request(app).patch(path).set('Cookie', this.cookie).set('X-CSRF-Token', this.csrf).send(body);
  }

  put(path: string, body: unknown) {
    return request(app).put(path).set('Cookie', this.cookie).set('X-CSRF-Token', this.csrf).send(body);
  }
}

async function loginAs(targetEmail: string): Promise<ApiSession> {
  const session = new ApiSession();
  await session.bootstrap();
  const res = await session.login(targetEmail, PASSWORD);
  expect(res.status).toBe(200);
  return session;
}

describe.skipIf(!enabled)('administration integration (real database)', () => {
  const created = { userIds: [] as string[], deptIds: [] as string[], classIds: [] as string[] };

  let adminId = '';
  let hodAId = '';
  let hodBId = '';
  let faculty1Id = '';
  let faculty2Id = '';
  let student1Id = '';
  let deptAId = '';
  let deptBId = '';
  let classA1Id = '';
  let classB1Id = '';

  beforeAll(async () => {
    const pool = getPool();
    await runMigrations(pool, defaultMigrationsDir());

    const passwordHash = await hashPassword(PASSWORD);
    const users = await pool.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash, full_name, role, is_active) VALUES
         ($1, $7, 'IT Admin', 'admin', true),
         ($2, $7, 'IT HOD A', 'hod', true),
         ($3, $7, 'IT HOD B', 'hod', true),
         ($4, $7, 'IT Faculty One', 'faculty', true),
         ($5, $7, 'IT Faculty Two', 'faculty', true),
         ($6, $7, 'IT Student One', 'student', true)
       RETURNING id, email`,
      [adminEmail, hodAEmail, hodBEmail, faculty1Email, faculty2Email, student1Email, passwordHash],
    );
    const byEmail = new Map(users.rows.map((row) => [row.email, row.id]));
    adminId = byEmail.get(adminEmail) ?? '';
    hodAId = byEmail.get(hodAEmail) ?? '';
    hodBId = byEmail.get(hodBEmail) ?? '';
    faculty1Id = byEmail.get(faculty1Email) ?? '';
    faculty2Id = byEmail.get(faculty2Email) ?? '';
    student1Id = byEmail.get(student1Email) ?? '';

    const departments = await pool.query<{ id: string; name: string }>(
      `INSERT INTO departments (name, code, hod_user_id) VALUES
         ($1, $3, $5),
         ($2, $4, $6)
       RETURNING id, name`,
      [`IT QA Dept A ${runId}`, `IT QA Dept B ${runId}`, `A${runId.slice(0, 4)}`, `B${runId.slice(0, 4)}`, hodAId, hodBId],
    );
    const byName = new Map(departments.rows.map((row) => [row.name, row.id]));
    deptAId = byName.get(`IT QA Dept A ${runId}`) ?? '';
    deptBId = byName.get(`IT QA Dept B ${runId}`) ?? '';

    const classes = await pool.query<{ id: string; name: string }>(
      `INSERT INTO classes (department_id, name, academic_year) VALUES
         ($1, $3, '2026-27'),
         ($2, $4, '2026-27')
       RETURNING id, name`,
      [deptAId, deptBId, `IT QA Class A1 ${runId}`, `IT QA Class B1 ${runId}`],
    );
    const classByName = new Map(classes.rows.map((row) => [row.name, row.id]));
    classA1Id = classByName.get(`IT QA Class A1 ${runId}`) ?? '';
    classB1Id = classByName.get(`IT QA Class B1 ${runId}`) ?? '';

    await pool.query(
      `INSERT INTO enrollments (class_id, student_user_id) VALUES ($1, $2)`,
      [classA1Id, student1Id],
    );
    await pool.query(
      `INSERT INTO class_faculty (class_id, faculty_user_id, assigned_by) VALUES ($1, $2, $3)`,
      [classA1Id, faculty1Id, adminId],
    );

    for (const id of [adminId, hodAId, hodBId, faculty1Id, faculty2Id, student1Id, deptAId, deptBId, classA1Id, classB1Id]) {
      expect(id).not.toBe('');
    }
  });

  afterAll(async () => {
    const pool = getPool();
    const userIds = [adminId, hodAId, hodBId, faculty1Id, faculty2Id, student1Id, ...created.userIds];
    const entityIds = [...userIds, deptAId, deptBId, ...created.deptIds, classA1Id, classB1Id, ...created.classIds];
    const classIds = [classA1Id, classB1Id, ...created.classIds];
    const deptIds = [deptAId, deptBId, ...created.deptIds];

    await pool.query('BEGIN');
    await pool.query(
      'DELETE FROM audit_log WHERE actor_user_id = ANY($1::uuid[]) OR entity_id = ANY($2::text[])',
      [userIds, entityIds],
    );
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

  it('enforces the strict 1:1 HOD rule on department assignment', async () => {
    const admin = await loginAs(adminEmail);

    const list = await admin.get('/api/admin/departments');
    expect(list.status).toBe(200);
    const deptA = list.body.departments.find((d: { id: string }) => d.id === deptAId);
    expect(deptA.hod.email).toBe(hodAEmail);

    const created2 = await admin.post('/api/admin/departments', {
      name: `IT QA Dept C ${runId}`,
      code: `C${runId.slice(0, 4)}`,
    });
    expect(created2.status).toBe(201);
    const deptCId = created2.body.department.id as string;
    created.deptIds.push(deptCId);

    const conflict = await admin.put(`/api/admin/departments/${deptCId}/hod`, { hodUserId: hodAId });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toMatch(/already heads/);

    const clear = await admin.put(`/api/admin/departments/${deptCId}/hod`, { hodUserId: null });
    expect(clear.status).toBe(200);
    expect(clear.body.department.hod).toBeNull();
  });

  it('creates accounts and classes through the admin API with validation', async () => {
    const admin = await loginAs(adminEmail);

    const newHod = await admin.post('/api/admin/users', {
      fullName: 'IT Created HOD',
      email: email('created-hod'),
      role: 'hod',
      password: PASSWORD,
    });
    expect(newHod.status).toBe(201);
    expect(newHod.body.user.role).toBe('hod');
    expect(newHod.body.user).not.toHaveProperty('passwordHash');
    created.userIds.push(newHod.body.user.id);

    const duplicate = await admin.post('/api/admin/users', {
      fullName: 'IT Created HOD',
      email: email('created-hod'),
      role: 'hod',
      password: PASSWORD,
    });
    expect(duplicate.status).toBe(409);

    const weak = await admin.post('/api/admin/users', {
      fullName: 'Weak Account',
      email: email('weak'),
      role: 'faculty',
      password: 'short',
    });
    expect(weak.status).toBe(400);

    const newClass = await admin.post('/api/admin/classes', {
      departmentId: deptAId,
      name: `IT QA Class A2 ${runId}`,
      academicYear: '2026-27',
    });
    expect(newClass.status).toBe(201);
    created.classIds.push(newClass.body.class.id);

    const duplicateClass = await admin.post('/api/admin/classes', {
      departmentId: deptAId,
      name: `IT QA Class A2 ${runId}`,
      academicYear: '2026-27',
    });
    expect(duplicateClass.status).toBe(409);

    const renamed = await admin.patch(`/api/admin/classes/${newClass.body.class.id}`, {
      name: `IT QA Class A2b ${runId}`,
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.class.name).toBe(`IT QA Class A2b ${runId}`);
  });

  it('scopes HOD access to their own department', async () => {
    const hodA = await loginAs(hodAEmail);

    const overview = await hodA.get('/api/hod/overview');
    expect(overview.status).toBe(200);
    expect(overview.body.department.id).toBe(deptAId);
    expect(overview.body.classes.some((c: { id: string }) => c.id === classA1Id)).toBe(true);
    expect(overview.body.classes.some((c: { id: string }) => c.id === classB1Id)).toBe(false);

    const otherClass = await hodA.get(`/api/hod/classes/${classB1Id}`);
    expect(otherClass.status).toBe(404);

    const otherAssign = await hodA.post(`/api/hod/classes/${classB1Id}/faculty`, {
      facultyUserId: faculty2Id,
    });
    expect(otherAssign.status).toBe(404);
  });

  it('runs the faculty assignment lifecycle with full history', async () => {
    const hodA = await loginAs(hodAEmail);

    const assigned = await hodA.post(`/api/hod/classes/${classA1Id}/faculty`, {
      facultyUserId: faculty2Id,
    });
    expect(assigned.status).toBe(201);
    const assignmentId = assigned.body.assignment.id as string;

    const duplicate = await hodA.post(`/api/hod/classes/${classA1Id}/faculty`, {
      facultyUserId: faculty2Id,
    });
    expect(duplicate.status).toBe(409);

    const ended = await hodA.post(`/api/hod/assignments/${assignmentId}/end`);
    expect(ended.status).toBe(200);
    const endAgain = await hodA.post(`/api/hod/assignments/${assignmentId}/end`);
    expect(endAgain.status).toBe(409);

    const reassigned = await hodA.post(`/api/hod/classes/${classA1Id}/faculty`, {
      facultyUserId: faculty2Id,
    });
    expect(reassigned.status).toBe(201);

    const detail = await hodA.get(`/api/hod/classes/${classA1Id}`);
    expect(detail.status).toBe(200);
    const faculty2Active = detail.body.assignments.active.filter(
      (a: { facultyUserId: string }) => a.facultyUserId === faculty2Id,
    );
    const faculty2History = detail.body.assignments.history.filter(
      (a: { facultyUserId: string }) => a.facultyUserId === faculty2Id,
    );
    expect(faculty2Active).toHaveLength(1);
    expect(faculty2History).toHaveLength(1);

    const hodB = await loginAs(hodBEmail);
    const endForeign = await hodB.post(`/api/hod/assignments/${faculty2Active[0].id}/end`);
    expect(endForeign.status).toBe(404);
  });

  it('scopes faculty to assigned classes and manages the roster lifecycle', async () => {
    const faculty1 = await loginAs(faculty1Email);

    const classes = await faculty1.get('/api/faculty/classes');
    expect(classes.status).toBe(200);
    expect(classes.body.classes.some((c: { id: string }) => c.id === classA1Id)).toBe(true);

    const foreign = await faculty1.get(`/api/faculty/classes/${classB1Id}`);
    expect(foreign.status).toBe(404);

    const foreignCreate = await faculty1.post(`/api/faculty/classes/${classB1Id}/students`, {
      fullName: 'IT Out Of Scope',
      email: email('oos'),
      password: PASSWORD,
    });
    expect(foreignCreate.status).toBe(404);

    const studentEmail = email('stu2');
    const createdStudent = await faculty1.post(`/api/faculty/classes/${classA1Id}/students`, {
      fullName: 'IT Student Two',
      email: studentEmail,
      password: PASSWORD,
    });
    expect(createdStudent.status).toBe(201);
    const student2Id = createdStudent.body.student.id as string;
    created.userIds.push(student2Id);

    const duplicateEmail = await faculty1.post(`/api/faculty/classes/${classA1Id}/students`, {
      fullName: 'IT Student Two',
      email: studentEmail,
      password: PASSWORD,
    });
    expect(duplicateEmail.status).toBe(409);

    const alreadyEnrolled = await faculty1.post(`/api/faculty/classes/${classA1Id}/enroll`, {
      email: studentEmail,
    });
    expect(alreadyEnrolled.status).toBe(409);

    const unenrolled = await faculty1.post(
      `/api/faculty/classes/${classA1Id}/students/${student2Id}/unenroll`,
    );
    expect(unenrolled.status).toBe(200);
    const unenrollAgain = await faculty1.post(
      `/api/faculty/classes/${classA1Id}/students/${student2Id}/unenroll`,
    );
    expect(unenrollAgain.status).toBe(404);

    const reenrolled = await faculty1.post(`/api/faculty/classes/${classA1Id}/enroll`, {
      email: studentEmail,
    });
    expect(reenrolled.status).toBe(201);

    const roster = await faculty1.get(`/api/faculty/classes/${classA1Id}`);
    expect(roster.status).toBe(200);
    const activeStudent2 = roster.body.students.filter(
      (entry: { student: { id: string } }) => entry.student.id === student2Id,
    );
    const formerStudent2 = roster.body.formerStudents.filter(
      (entry: { student: { id: string } }) => entry.student.id === student2Id,
    );
    expect(activeStudent2).toHaveLength(1);
    expect(formerStudent2).toHaveLength(1);

    const renamed = await faculty1.patch(
      `/api/faculty/classes/${classA1Id}/students/${student2Id}`,
      { fullName: 'IT Student Two Renamed' },
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body.student.fullName).toBe('IT Student Two Renamed');

    const reset = await faculty1.post(
      `/api/faculty/classes/${classA1Id}/students/${student2Id}/reset-password`,
      { newPassword: 'R3set-Password!' },
    );
    expect(reset.status).toBe(204);

    const student2 = new ApiSession();
    await student2.bootstrap();
    const login = await student2.login(studentEmail, 'R3set-Password!');
    expect(login.status).toBe(200);

    const denied = await student2.get('/api/admin/overview');
    expect(denied.status).toBe(403);
  });

  it('guards role changes while active role-bound records exist', async () => {
    const admin = await loginAs(adminEmail);

    const studentBlocked = await admin.post(`/api/admin/users/${student1Id}/role`, {
      role: 'faculty',
    });
    expect(studentBlocked.status).toBe(409);
    expect(studentBlocked.body.error).toMatch(/enrolled/);

    const hodBlocked = await admin.post(`/api/admin/users/${hodAId}/role`, { role: 'faculty' });
    expect(hodBlocked.status).toBe(409);
    expect(hodBlocked.body.error).toMatch(/HOD/);

    const facultyBlocked = await admin.post(`/api/admin/users/${faculty1Id}/role`, {
      role: 'student',
    });
    expect(facultyBlocked.status).toBe(409);
    expect(facultyBlocked.body.error).toMatch(/assigned/);

    const selfRole = await admin.post(`/api/admin/users/${adminId}/role`, { role: 'student' });
    expect(selfRole.status).toBe(400);

    const selfDeactivate = await admin.post(`/api/admin/users/${adminId}/status`, {
      isActive: false,
    });
    expect(selfDeactivate.status).toBe(400);
  });

  it('promotes a class into another class in the same department', async () => {
    const admin = await loginAs(adminEmail);
    const pool = getPool();

    const source = await admin.post('/api/admin/classes', {
      departmentId: deptAId,
      name: `IT QA Promo Source ${runId}`,
      academicYear: '2026-27',
    });
    expect(source.status).toBe(201);
    const sourceId = source.body.class.id as string;
    created.classIds.push(sourceId);

    const target = await admin.post('/api/admin/classes', {
      departmentId: deptAId,
      name: `IT QA Promo Target ${runId}`,
      academicYear: '2027-28',
    });
    expect(target.status).toBe(201);
    const targetId = target.body.class.id as string;
    created.classIds.push(targetId);

    const empty = await admin.post('/api/admin/classes', {
      departmentId: deptAId,
      name: `IT QA Promo Empty ${runId}`,
      academicYear: '2027-28',
    });
    expect(empty.status).toBe(201);
    const emptyId = empty.body.class.id as string;
    created.classIds.push(emptyId);

    const passwordHash = await hashPassword(PASSWORD);
    const promo1Email = email('promo1');
    const promo2Email = email('promo2');
    const promo3Email = email('promo3');
    const students = await pool.query<{ id: string; email: string }>(
      `INSERT INTO users (email, password_hash, full_name, role, is_active) VALUES
         ($1, $4, 'IT Promo Student One', 'student', true),
         ($2, $4, 'IT Promo Student Two', 'student', true),
         ($3, $4, 'IT Promo Student Three', 'student', true)
       RETURNING id, email`,
      [promo1Email, promo2Email, promo3Email, passwordHash],
    );
    const byEmail = new Map(students.rows.map((row) => [row.email, row.id]));
    const promo1Id = byEmail.get(promo1Email) ?? '';
    const promo2Id = byEmail.get(promo2Email) ?? '';
    const promo3Id = byEmail.get(promo3Email) ?? '';
    for (const id of [promo1Id, promo2Id, promo3Id]) {
      expect(id).not.toBe('');
    }
    created.userIds.push(promo1Id, promo2Id, promo3Id);

    await pool.query(
      `INSERT INTO enrollments (class_id, student_user_id) VALUES
         ($1, $2), ($1, $3), ($1, $4)`,
      [sourceId, promo1Id, promo2Id, promo3Id],
    );
    await pool.query(
      `INSERT INTO enrollments (class_id, student_user_id) VALUES ($1, $2)`,
      [targetId, promo2Id],
    );
    // Inactive accounts cannot receive a new enrollment; they are reported
    // and left in the source class for manual follow-up.
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [promo3Id]);

    const openSession = await pool.query<{ id: string }>(
      `INSERT INTO attendance_sessions (class_id, session_date, started_by)
       VALUES ($1, CURRENT_DATE, $2) RETURNING id`,
      [sourceId, adminId],
    );
    const openSessionId = openSession.rows[0]?.id ?? '';
    expect(openSessionId).not.toBe('');
    const blockedByOpenSession = await admin.post(`/api/admin/classes/${sourceId}/promote`, {
      targetClassId: targetId,
    });
    expect(blockedByOpenSession.status).toBe(409);
    expect(blockedByOpenSession.body.error).toMatch(/open attendance session/);
    await pool.query('DELETE FROM attendance_sessions WHERE id = $1', [openSessionId]);

    const hod = await loginAs(hodAEmail);
    const denied = await hod.post(`/api/admin/classes/${sourceId}/promote`, {
      targetClassId: targetId,
    });
    expect(denied.status).toBe(403);

    const crossDepartment = await admin.post(`/api/admin/classes/${sourceId}/promote`, {
      targetClassId: classB1Id,
    });
    expect(crossDepartment.status).toBe(400);
    expect(crossDepartment.body.error).toMatch(/same department/);

    const sameClass = await admin.post(`/api/admin/classes/${sourceId}/promote`, {
      targetClassId: sourceId,
    });
    expect(sameClass.status).toBe(400);

    const noStudents = await admin.post(`/api/admin/classes/${emptyId}/promote`, {
      targetClassId: targetId,
    });
    expect(noStudents.status).toBe(409);

    const promoted = await admin.post(`/api/admin/classes/${sourceId}/promote`, {
      targetClassId: targetId,
    });
    expect(promoted.status).toBe(200);
    expect(promoted.body.promotion).toMatchObject({
      sourceClass: { id: sourceId, name: `IT QA Promo Source ${runId}`, academicYear: '2026-27' },
      targetClass: { id: targetId, name: `IT QA Promo Target ${runId}`, academicYear: '2027-28' },
      promotedCount: 1,
      alreadyEnrolledCount: 1,
      skippedInactiveCount: 1,
    });

    const sourceActive = await pool.query<{ student_user_id: string }>(
      `SELECT student_user_id FROM enrollments
        WHERE class_id = $1 AND unenrolled_at IS NULL`,
      [sourceId],
    );
    expect(sourceActive.rows.map((row) => row.student_user_id)).toEqual([promo3Id]);

    const targetActive = await pool.query<{ student_user_id: string }>(
      `SELECT student_user_id FROM enrollments
        WHERE class_id = $1 AND unenrolled_at IS NULL`,
      [targetId],
    );
    expect(new Set(targetActive.rows.map((row) => row.student_user_id))).toEqual(
      new Set([promo1Id, promo2Id]),
    );

    const sourceHistory = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM enrollments
        WHERE class_id = $1 AND unenrolled_at IS NOT NULL`,
      [sourceId],
    );
    expect(sourceHistory.rows[0]?.count).toBe(2);

    const audit = await pool.query<{
      new_value: {
        promotedCount: number;
        alreadyEnrolledCount: number;
        skippedInactiveCount: number;
        promotedStudentUserIds: string[];
        alreadyEnrolledStudentUserIds: string[];
        skippedInactiveStudentUserIds: string[];
      };
    }>(
      `SELECT new_value FROM audit_log
        WHERE action = 'admin.class_promote' AND entity_id = $1
        ORDER BY id DESC LIMIT 1`,
      [targetId],
    );
    expect(audit.rows[0]?.new_value).toMatchObject({
      promotedCount: 1,
      alreadyEnrolledCount: 1,
      skippedInactiveCount: 1,
      promotedStudentUserIds: [promo1Id],
      alreadyEnrolledStudentUserIds: [promo2Id],
      skippedInactiveStudentUserIds: [promo3Id],
    });

    const retry = await admin.post(`/api/admin/classes/${sourceId}/promote`, {
      targetClassId: targetId,
    });
    expect(retry.status).toBe(409);
  });

  it('deactivates accounts immediately and writes a credential-free audit trail', async () => {
    const admin = await loginAs(adminEmail);

    const target = await admin.post('/api/admin/users', {
      fullName: 'IT Toggle',
      email: email('toggle'),
      role: 'faculty',
      password: PASSWORD,
    });
    expect(target.status).toBe(201);
    const toggleId = target.body.user.id as string;
    created.userIds.push(toggleId);

    const off = await admin.post(`/api/admin/users/${toggleId}/status`, { isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.user.isActive).toBe(false);

    const blocked = new ApiSession();
    await blocked.bootstrap();
    const login = await blocked.login(email('toggle'), PASSWORD);
    expect(login.status).toBe(403);

    const on = await admin.post(`/api/admin/users/${toggleId}/status`, { isActive: true });
    expect(on.status).toBe(200);

    // A successful role change (no active role-bound records) so the audit
    // check below can confirm role changes are recorded.
    const roleChange = await admin.post(`/api/admin/users/${toggleId}/role`, { role: 'student' });
    expect(roleChange.status).toBe(200);

    const pool = getPool();
    const auditActions = await pool.query<{ action: string }>(
      `SELECT DISTINCT action FROM audit_log
        WHERE actor_user_id = ANY($1::uuid[]) OR entity_id = ANY($2::text[])`,
      [
        [adminId, hodAId, hodBId, faculty1Id, faculty2Id, student1Id, ...created.userIds],
        [deptAId, classA1Id, student1Id, ...created.deptIds, ...created.classIds],
      ],
    );
    const actions = new Set(auditActions.rows.map((row) => row.action));
    for (const expected of [
      'admin.department_hod_assign',
      'admin.user_create',
      'admin.user_status',
      'admin.user_role_change',
      'admin.class_update',
      'admin.class_promote',
      'hod.faculty_assign',
      'hod.faculty_unassign',
      'faculty.student_create',
      'faculty.student_unenroll',
    ]) {
      expect(actions.has(expected), `missing audit action ${expected}`).toBe(true);
    }

    const leak = await pool.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM audit_log
        WHERE new_value::text ILIKE '%password%' OR old_value::text ILIKE '%password%'
           OR new_value::text ILIKE '%argon2%' OR old_value::text ILIKE '%argon2%'`,
    );
    expect(leak.rows[0]?.count).toBe(0);
  });
});
