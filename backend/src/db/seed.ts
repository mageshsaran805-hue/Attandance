import type { PoolClient } from 'pg';
import { env, isDatabaseConfigured } from '../config/env.js';
import { hashPassword } from '../lib/password.js';
import { closePool, getPool } from './pool.js';

/**
 * Development seed: deterministic FAKE data only (never real students).
 *
 * Idempotent — safe to run repeatedly: users are matched by email,
 * departments by code, classes by (department, name, academic year),
 * enrollments and faculty assignments by their active rows.
 *
 * Usage: `npm run seed:dev` (backend/), with DATABASE_URL configured.
 */

export const DEMO_PASSWORD = 'Demo@12345';

interface SeedUser {
  email: string;
  fullName: string;
  role: 'admin' | 'hod' | 'faculty' | 'student';
}

async function upsertUser(client: PoolClient, user: SeedUser, passwordHash: string): Promise<string> {
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM users WHERE lower(email) = lower($1)',
    [user.email],
  );

  const existingId = existing.rows[0]?.id;
  if (existingId) {
    await client.query(
      'UPDATE users SET full_name = $2, role = $3, is_active = true, password_hash = $4 WHERE id = $1',
      [existingId, user.fullName, user.role, passwordHash],
    );
    return existingId;
  }

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [user.email, passwordHash, user.fullName, user.role],
  );
  return inserted.rows[0]!.id;
}

async function upsertDepartment(client: PoolClient, name: string, code: string, hodUserId: string): Promise<string> {
  const existing = await client.query<{ id: string }>('SELECT id FROM departments WHERE code = $1', [code]);
  const existingId = existing.rows[0]?.id;
  if (existingId) {
    await client.query('UPDATE departments SET name = $2, hod_user_id = $3 WHERE id = $1', [
      existingId,
      name,
      hodUserId,
    ]);
    return existingId;
  }
  const inserted = await client.query<{ id: string }>(
    'INSERT INTO departments (name, code, hod_user_id) VALUES ($1, $2, $3) RETURNING id',
    [name, code, hodUserId],
  );
  return inserted.rows[0]!.id;
}

async function upsertClass(
  client: PoolClient,
  departmentId: string,
  name: string,
  academicYear: string,
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM classes WHERE department_id = $1 AND name = $2 AND academic_year = $3',
    [departmentId, name, academicYear],
  );
  const existingId = existing.rows[0]?.id;
  if (existingId) {
    return existingId;
  }
  const inserted = await client.query<{ id: string }>(
    'INSERT INTO classes (department_id, name, academic_year) VALUES ($1, $2, $3) RETURNING id',
    [departmentId, name, academicYear],
  );
  return inserted.rows[0]!.id;
}

async function enrollStudent(client: PoolClient, classId: string, studentUserId: string): Promise<void> {
  const existing = await client.query(
    'SELECT id FROM enrollments WHERE class_id = $1 AND student_user_id = $2 AND unenrolled_at IS NULL',
    [classId, studentUserId],
  );
  if (existing.rowCount === 0) {
    await client.query('INSERT INTO enrollments (class_id, student_user_id) VALUES ($1, $2)', [
      classId,
      studentUserId,
    ]);
  }
}

async function assignFaculty(
  client: PoolClient,
  classId: string,
  facultyUserId: string,
  assignedBy: string,
): Promise<void> {
  const existing = await client.query(
    'SELECT id FROM class_faculty WHERE class_id = $1 AND faculty_user_id = $2 AND unassigned_at IS NULL',
    [classId, facultyUserId],
  );
  if (existing.rowCount === 0) {
    await client.query(
      'INSERT INTO class_faculty (class_id, faculty_user_id, assigned_by) VALUES ($1, $2, $3)',
      [classId, facultyUserId, assignedBy],
    );
  }
}

const ADMIN: SeedUser = { email: 'admin@college.test', fullName: 'Meera Krishnan', role: 'admin' };
const HOD_CSE: SeedUser = { email: 'hod.cse@college.test', fullName: 'Dr. Anita Sharma', role: 'hod' };
const HOD_ECE: SeedUser = { email: 'hod.ece@college.test', fullName: 'Dr. Rajesh Kumar', role: 'hod' };
const FACULTY: SeedUser[] = [
  { email: 'priya.menon@college.test', fullName: 'Priya Menon', role: 'faculty' },
  { email: 'arjun.rao@college.test', fullName: 'Arjun Rao', role: 'faculty' },
  { email: 'sunita.patel@college.test', fullName: 'Sunita Patel', role: 'faculty' },
  { email: 'vikram.iyer@college.test', fullName: 'Vikram Iyer', role: 'faculty' },
];
const CSE_A_STUDENTS: SeedUser[] = [
  { email: 'aarti.nair@college.test', fullName: 'Aarti Nair', role: 'student' },
  { email: 'rohan.gupta@college.test', fullName: 'Rohan Gupta', role: 'student' },
  { email: 'sneha.reddy@college.test', fullName: 'Sneha Reddy', role: 'student' },
  { email: 'karthik.subramanian@college.test', fullName: 'Karthik Subramanian', role: 'student' },
  { email: 'divya.joshi@college.test', fullName: 'Divya Joshi', role: 'student' },
  { email: 'mohammed.farhan@college.test', fullName: 'Mohammed Farhan', role: 'student' },
];
const CSE_B_STUDENTS: SeedUser[] = [
  { email: 'nisha.verma@college.test', fullName: 'Nisha Verma', role: 'student' },
  { email: 'aditya.kulkarni@college.test', fullName: 'Aditya Kulkarni', role: 'student' },
  { email: 'lakshmi.narayanan@college.test', fullName: 'Lakshmi Narayanan', role: 'student' },
  { email: 'rahul.menon@college.test', fullName: 'Rahul Menon', role: 'student' },
  { email: 'pooja.shetty@college.test', fullName: 'Pooja Shetty', role: 'student' },
];
const ECE_A_STUDENTS: SeedUser[] = [
  { email: 'gautam.bose@college.test', fullName: 'Gautam Bose', role: 'student' },
  { email: 'ananya.pillai@college.test', fullName: 'Ananya Pillai', role: 'student' },
  { email: 'faisal.khan@college.test', fullName: 'Faisal Khan', role: 'student' },
  { email: 'shreya.deshpande@college.test', fullName: 'Shreya Deshpande', role: 'student' },
  { email: 'naveen.chandra@college.test', fullName: 'Naveen Chandra', role: 'student' },
];

async function seed(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed fake development data with NODE_ENV=production.');
  }
  if (!isDatabaseConfigured) {
    throw new Error(
      'DATABASE_URL is not set. Copy backend/.env.example to backend/.env, paste your Supabase connection string, then run this command again.',
    );
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // One hash is reused for every demo account: the password is public,
    // fake development data, and this keeps the seed fast.
    const passwordHash = await hashPassword(DEMO_PASSWORD);

    const adminId = await upsertUser(client, ADMIN, passwordHash);
    const hodCseId = await upsertUser(client, HOD_CSE, passwordHash);
    const hodEceId = await upsertUser(client, HOD_ECE, passwordHash);
    const facultyIds = new Map<string, string>();
    for (const member of FACULTY) {
      facultyIds.set(member.email, await upsertUser(client, member, passwordHash));
    }
    const studentIds = new Map<string, string>();
    for (const student of [...CSE_A_STUDENTS, ...CSE_B_STUDENTS, ...ECE_A_STUDENTS]) {
      studentIds.set(student.email, await upsertUser(client, student, passwordHash));
    }

    const cseId = await upsertDepartment(client, 'Computer Science', 'CSE', hodCseId);
    const eceId = await upsertDepartment(client, 'Electronics and Communication', 'ECE', hodEceId);

    const cseAId = await upsertClass(client, cseId, '3rd Year — Section A', '2026-27');
    const cseBId = await upsertClass(client, cseId, '3rd Year — Section B', '2026-27');
    const eceAId = await upsertClass(client, eceId, '2nd Year — Section A', '2026-27');

    for (const student of CSE_A_STUDENTS) {
      await enrollStudent(client, cseAId, studentIds.get(student.email)!);
    }
    for (const student of CSE_B_STUDENTS) {
      await enrollStudent(client, cseBId, studentIds.get(student.email)!);
    }
    for (const student of ECE_A_STUDENTS) {
      await enrollStudent(client, eceAId, studentIds.get(student.email)!);
    }

    // Vikram Iyer stays unassigned so the HOD assignment workflow has
    // something to demonstrate.
    await assignFaculty(client, cseAId, facultyIds.get('priya.menon@college.test')!, hodCseId);
    await assignFaculty(client, cseBId, facultyIds.get('arjun.rao@college.test')!, hodCseId);
    await assignFaculty(client, eceAId, facultyIds.get('sunita.patel@college.test')!, hodEceId);

    await client.query('COMMIT');

    console.log('[seed] development data ready (fake accounts only)');
    console.log(`[seed] all accounts use the password: ${DEMO_PASSWORD}`);
    console.log('[seed] accounts:');
    for (const user of [ADMIN, HOD_CSE, HOD_ECE, ...FACULTY, ...CSE_A_STUDENTS, ...CSE_B_STUDENTS, ...ECE_A_STUDENTS]) {
      console.log(`[seed]   ${user.role.padEnd(7)} ${user.email.padEnd(38)} ${user.fullName}`);
    }
    console.log(`[seed] admin id (for reference): ${adminId}`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

seed()
  .catch((error: unknown) => {
    console.error('[seed] error:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    closePool().catch(() => undefined);
  });
