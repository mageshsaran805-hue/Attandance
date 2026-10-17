import type { Pool, PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { expectRow } from '../lib/errors.js';

/**
 * Enrollment queries. Rows are never deleted: unenrolling stamps
 * `unenrolled_at`, and re-enrolling creates a fresh row so the full
 * membership history stays available.
 */

export interface EnrollmentRow {
  id: string;
  classId: string;
  studentUserId: string;
  enrolledAt: string;
  unenrolledAt: string | null;
}

export interface RosterEntry {
  enrollmentId: string;
  enrolledAt: string;
  unenrolledAt: string | null;
  student: {
    id: string;
    fullName: string;
    email: string;
    isActive: boolean;
    registerNumber: string | null;
    phone: string | null;
    section: string | null;
  };
}

interface DbEnrollmentRow {
  id: string;
  class_id: string;
  student_user_id: string;
  enrolled_at: string;
  unenrolled_at: string | null;
}

interface DbRosterRow {
  enrollment_id: string;
  enrolled_at: string;
  unenrolled_at: string | null;
  student_id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  register_number: string | null;
  phone: string | null;
  section: string | null;
}

const ENROLLMENT_COLUMNS = 'id, class_id, student_user_id, enrolled_at, unenrolled_at';

function mapEnrollment(row: DbEnrollmentRow): EnrollmentRow {
  return {
    id: row.id,
    classId: row.class_id,
    studentUserId: row.student_user_id,
    enrolledAt: row.enrolled_at,
    unenrolledAt: row.unenrolled_at,
  };
}

export async function findActiveEnrollment(
  classId: string,
  studentUserId: string,
  client?: Pool | PoolClient,
): Promise<EnrollmentRow | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbEnrollmentRow>(
    `SELECT ${ENROLLMENT_COLUMNS} FROM enrollments
      WHERE class_id = $1 AND student_user_id = $2 AND unenrolled_at IS NULL
      LIMIT 1`,
    [classId, studentUserId],
  );
  const row = rows[0];
  return row ? mapEnrollment(row) : null;
}

export async function createEnrollment(
  classId: string,
  studentUserId: string,
  client?: Pool | PoolClient,
): Promise<EnrollmentRow> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbEnrollmentRow>(
    `INSERT INTO enrollments (class_id, student_user_id) VALUES ($1, $2) RETURNING ${ENROLLMENT_COLUMNS}`,
    [classId, studentUserId],
  );
  return mapEnrollment(expectRow(rows[0], 'enrollments: insert'));
}

/** Ends an active enrollment; returns null when it was already ended. */
export async function endEnrollment(
  enrollmentId: string,
  client?: Pool | PoolClient,
): Promise<EnrollmentRow | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbEnrollmentRow>(
    `UPDATE enrollments SET unenrolled_at = now()
      WHERE id = $1 AND unenrolled_at IS NULL
      RETURNING ${ENROLLMENT_COLUMNS}`,
    [enrollmentId],
  );
  const row = rows[0];
  return row ? mapEnrollment(row) : null;
}

export async function listRoster(
  classId: string,
): Promise<{ students: RosterEntry[]; formerStudents: RosterEntry[] }> {
  const { rows } = await getPool().query<DbRosterRow>(
    `SELECT e.id AS enrollment_id, e.enrolled_at, e.unenrolled_at,
            u.id AS student_id, u.full_name, u.email, u.is_active,
            u.register_number, u.phone, u.section
       FROM enrollments e
       JOIN users u ON u.id = e.student_user_id
      WHERE e.class_id = $1
      ORDER BY u.full_name, e.enrolled_at DESC`,
    [classId],
  );

  const students: RosterEntry[] = [];
  const formerStudents: RosterEntry[] = [];
  for (const row of rows) {
    const entry: RosterEntry = {
      enrollmentId: row.enrollment_id,
      enrolledAt: row.enrolled_at,
      unenrolledAt: row.unenrolled_at,
      student: {
        id: row.student_id,
        fullName: row.full_name,
        email: row.email,
        isActive: row.is_active,
        registerNumber: row.register_number,
        phone: row.phone,
        section: row.section,
      },
    };
    (row.unenrolled_at === null ? students : formerStudents).push(entry);
  }
  return { students, formerStudents };
}

export async function countActiveEnrollmentsForStudent(
  studentUserId: string,
  client?: Pool | PoolClient,
): Promise<number> {
  const db = client ?? getPool();
  const { rows } = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM enrollments WHERE student_user_id = $1 AND unenrolled_at IS NULL',
    [studentUserId],
  );
  return expectRow(rows[0], 'enrollments: count').count;
}
