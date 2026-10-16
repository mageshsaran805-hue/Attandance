import type { Pool, PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { expectRow } from '../lib/errors.js';

/**
 * Student self-registration queries. A registration row is submitted by the
 * public form and resolved exactly once: approval creates the student account
 * and enrolls it, rejection keeps the row for history. The application never
 * deletes rows, and the password only ever exists here as a hash.
 */

export type RegistrationStatus = 'pending' | 'approved' | 'rejected';

export interface RegistrationRow {
  id: string;
  fullName: string;
  email: string;
  registerNumber: string;
  phone: string | null;
  classId: string;
  passwordHash: string;
  status: RegistrationStatus;
  submittedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdUserId: string | null;
}

interface DbRegistrationRow {
  id: string;
  full_name: string;
  email: string;
  register_number: string;
  phone: string | null;
  class_id: string;
  password_hash: string;
  status: RegistrationStatus;
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_user_id: string | null;
}

const REGISTRATION_COLUMNS =
  'id, full_name, email, register_number, phone, class_id, password_hash, status, submitted_at, reviewed_by, reviewed_at, created_user_id';

function mapRegistration(row: DbRegistrationRow): RegistrationRow {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    registerNumber: row.register_number,
    phone: row.phone,
    classId: row.class_id,
    passwordHash: row.password_hash,
    status: row.status,
    submittedAt: row.submitted_at,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdUserId: row.created_user_id,
  };
}

export async function createRegistration(
  input: {
    fullName: string;
    email: string;
    registerNumber: string;
    phone: string | null;
    classId: string;
    passwordHash: string;
  },
  client?: Pool | PoolClient,
): Promise<RegistrationRow> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbRegistrationRow>(
    `INSERT INTO student_registrations
       (full_name, email, register_number, phone, class_id, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${REGISTRATION_COLUMNS}`,
    [input.fullName, input.email, input.registerNumber, input.phone, input.classId, input.passwordHash],
  );
  return mapRegistration(expectRow(rows[0], 'student_registrations: insert'));
}

/** Row lock used while approving/rejecting, so concurrent reviews settle once. */
export async function getRegistrationForUpdate(
  id: string,
  client: PoolClient,
): Promise<RegistrationRow | null> {
  const { rows } = await client.query<DbRegistrationRow>(
    `SELECT ${REGISTRATION_COLUMNS} FROM student_registrations WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const row = rows[0];
  return row ? mapRegistration(row) : null;
}

/** Marks a pending row approved; null when it was already reviewed. */
export async function approveRegistration(
  id: string,
  reviewedBy: string,
  createdUserId: string,
  client?: Pool | PoolClient,
): Promise<RegistrationRow | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbRegistrationRow>(
    `UPDATE student_registrations
        SET status = 'approved', reviewed_by = $2, reviewed_at = now(), created_user_id = $3
      WHERE id = $1 AND status = 'pending'
      RETURNING ${REGISTRATION_COLUMNS}`,
    [id, reviewedBy, createdUserId],
  );
  const row = rows[0];
  return row ? mapRegistration(row) : null;
}

/** Marks a pending row rejected; null when it was already reviewed. */
export async function rejectRegistration(
  id: string,
  reviewedBy: string,
  client?: Pool | PoolClient,
): Promise<RegistrationRow | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbRegistrationRow>(
    `UPDATE student_registrations
        SET status = 'rejected', reviewed_by = $2, reviewed_at = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING ${REGISTRATION_COLUMNS}`,
    [id, reviewedBy],
  );
  const row = rows[0];
  return row ? mapRegistration(row) : null;
}

// ---------------------------------------------------------------------------
// Admin review queue
// ---------------------------------------------------------------------------

export interface AdminRegistrationEntry {
  id: string;
  fullName: string;
  email: string;
  registerNumber: string;
  phone: string | null;
  status: RegistrationStatus;
  submittedAt: string;
  reviewedAt: string | null;
  reviewedBy: { fullName: string; email: string } | null;
  createdUser: { id: string; email: string } | null;
  class: {
    id: string;
    name: string;
    academicYear: string;
    department: { id: string; name: string; code: string };
  };
}

interface DbAdminRegistrationRow {
  id: string;
  full_name: string;
  email: string;
  register_number: string;
  phone: string | null;
  status: RegistrationStatus;
  submitted_at: string;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  reviewed_by_email: string | null;
  created_user_id: string | null;
  created_user_email: string | null;
  class_id: string;
  class_name: string;
  academic_year: string;
  department_id: string;
  department_name: string;
  department_code: string;
}

function mapAdminRegistration(row: DbAdminRegistrationRow): AdminRegistrationEntry {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    registerNumber: row.register_number,
    phone: row.phone,
    status: row.status,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewedBy:
      row.reviewed_by_email === null
        ? null
        : { fullName: row.reviewed_by_name ?? '', email: row.reviewed_by_email },
    createdUser:
      row.created_user_id === null
        ? null
        : { id: row.created_user_id, email: row.created_user_email ?? '' },
    class: {
      id: row.class_id,
      name: row.class_name,
      academicYear: row.academic_year,
      department: {
        id: row.department_id,
        name: row.department_name,
        code: row.department_code,
      },
    },
  };
}

const ADMIN_REGISTRATION_SQL = `
  SELECT r.id, r.full_name, r.email, r.register_number, r.phone, r.status,
         r.submitted_at, r.reviewed_at,
         rv.full_name AS reviewed_by_name, rv.email AS reviewed_by_email,
         cu.id AS created_user_id, cu.email AS created_user_email,
         c.id AS class_id, c.name AS class_name, c.academic_year,
         d.id AS department_id, d.name AS department_name, d.code AS department_code
    FROM student_registrations r
    JOIN classes c ON c.id = r.class_id
    JOIN departments d ON d.id = c.department_id
    LEFT JOIN users rv ON rv.id = r.reviewed_by
    LEFT JOIN users cu ON cu.id = r.created_user_id
   WHERE r.status = $1`;

export interface RegistrationListFilters {
  status: RegistrationStatus;
  page: number;
  limit: number;
}

export async function listRegistrations(
  filters: RegistrationListFilters,
): Promise<{ items: AdminRegistrationEntry[]; total: number; page: number; limit: number }> {
  const db = getPool();
  // The pending queue is worked oldest-first; history reads newest-first.
  const order = filters.status === 'pending' ? 'ASC' : 'DESC';
  const offset = (filters.page - 1) * filters.limit;

  const [items, count] = await Promise.all([
    db.query<DbAdminRegistrationRow>(
      `${ADMIN_REGISTRATION_SQL} ORDER BY r.submitted_at ${order}, r.id ${order} LIMIT $2 OFFSET $3`,
      [filters.status, filters.limit, offset],
    ),
    db.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM student_registrations WHERE status = $1`,
      [filters.status],
    ),
  ]);

  return {
    items: items.rows.map(mapAdminRegistration),
    total: expectRow(count.rows[0], 'student_registrations: count').total,
    page: filters.page,
    limit: filters.limit,
  };
}

export async function countPendingRegistrations(client?: Pool | PoolClient): Promise<number> {
  const db = client ?? getPool();
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM student_registrations WHERE status = 'pending'`,
  );
  return expectRow(rows[0], 'student_registrations: pending count').count;
}
