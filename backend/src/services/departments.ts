import type { Pool, PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { expectRow } from '../lib/errors.js';

/**
 * Department queries.
 *
 * Mutating functions accept an optional transaction client so a caller can
 * commit the change together with its audit entry (see db/transactions.ts).
 */

export interface DepartmentRow {
  id: string;
  name: string;
  code: string;
  hodUserId: string | null;
}

export interface DepartmentHodSummary {
  id: string;
  fullName: string;
  email: string;
}

export interface DepartmentWithDetails extends DepartmentRow {
  hod: DepartmentHodSummary | null;
  classCount: number;
  studentCount: number;
}

interface DbDepartmentRow {
  id: string;
  name: string;
  code: string;
  hod_user_id: string | null;
}

interface DbDepartmentDetailsRow extends DbDepartmentRow {
  hod_id: string | null;
  hod_full_name: string | null;
  hod_email: string | null;
  class_count: number;
  student_count: number;
}

const DEPARTMENT_COLUMNS = 'id, name, code, hod_user_id';

const DEPARTMENT_DETAILS_SQL = `
  SELECT d.id, d.name, d.code, d.hod_user_id,
         hu.id AS hod_id, hu.full_name AS hod_full_name, hu.email AS hod_email,
         (SELECT count(*)::int FROM classes c WHERE c.department_id = d.id) AS class_count,
         (SELECT count(*)::int FROM enrollments e
            JOIN classes c ON c.id = e.class_id
           WHERE c.department_id = d.id AND e.unenrolled_at IS NULL) AS student_count
    FROM departments d
    LEFT JOIN users hu ON hu.id = d.hod_user_id`;

function mapDepartment(row: DbDepartmentRow): DepartmentRow {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    hodUserId: row.hod_user_id,
  };
}

function mapDepartmentDetails(row: DbDepartmentDetailsRow): DepartmentWithDetails {
  return {
    ...mapDepartment(row),
    hod: row.hod_id
      ? { id: row.hod_id, fullName: row.hod_full_name ?? '', email: row.hod_email ?? '' }
      : null,
    classCount: row.class_count,
    studentCount: row.student_count,
  };
}

export async function listDepartments(): Promise<DepartmentWithDetails[]> {
  const { rows } = await getPool().query<DbDepartmentDetailsRow>(
    `${DEPARTMENT_DETAILS_SQL} ORDER BY d.name`,
  );
  return rows.map(mapDepartmentDetails);
}

export async function getDepartmentById(
  id: string,
  client?: Pool | PoolClient,
): Promise<DepartmentRow | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbDepartmentRow>(
    `SELECT ${DEPARTMENT_COLUMNS} FROM departments WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? mapDepartment(row) : null;
}

export async function getDepartmentWithDetails(id: string): Promise<DepartmentWithDetails | null> {
  const { rows } = await getPool().query<DbDepartmentDetailsRow>(
    `${DEPARTMENT_DETAILS_SQL} WHERE d.id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? mapDepartmentDetails(row) : null;
}

/** The department headed by the given user, if any (HOD scope lookup). */
export async function findDepartmentHeadedBy(
  hodUserId: string,
  client?: Pool | PoolClient,
): Promise<DepartmentRow | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbDepartmentRow>(
    `SELECT ${DEPARTMENT_COLUMNS} FROM departments WHERE hod_user_id = $1 LIMIT 1`,
    [hodUserId],
  );
  const row = rows[0];
  return row ? mapDepartment(row) : null;
}

export async function createDepartment(
  input: { name: string; code: string },
  client?: Pool | PoolClient,
): Promise<DepartmentRow> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbDepartmentRow>(
    `INSERT INTO departments (name, code) VALUES ($1, $2) RETURNING ${DEPARTMENT_COLUMNS}`,
    [input.name, input.code],
  );
  return mapDepartment(expectRow(rows[0], 'departments: insert'));
}

export async function updateDepartment(
  id: string,
  input: { name: string; code: string },
  client?: Pool | PoolClient,
): Promise<DepartmentRow | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbDepartmentRow>(
    `UPDATE departments SET name = $2, code = $3 WHERE id = $1 RETURNING ${DEPARTMENT_COLUMNS}`,
    [id, input.name, input.code],
  );
  const row = rows[0];
  return row ? mapDepartment(row) : null;
}

export async function setDepartmentHod(
  departmentId: string,
  hodUserId: string | null,
  client?: Pool | PoolClient,
): Promise<DepartmentRow | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbDepartmentRow>(
    `UPDATE departments SET hod_user_id = $2 WHERE id = $1 RETURNING ${DEPARTMENT_COLUMNS}`,
    [departmentId, hodUserId],
  );
  const row = rows[0];
  return row ? mapDepartment(row) : null;
}

export async function countDepartments(client?: Pool | PoolClient): Promise<number> {
  const db = client ?? getPool();
  const { rows } = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM departments',
  );
  return expectRow(rows[0], 'departments: count').count;
}

export interface DepartmentOverviewCounts {
  classes: number;
  students: number;
  faculty: number;
}

/** Headline numbers for the HOD overview of one department. */
export async function getDepartmentOverviewCounts(
  departmentId: string,
  client?: Pool | PoolClient,
): Promise<DepartmentOverviewCounts> {
  const db = client ?? getPool();
  const { rows } = await db.query<DepartmentOverviewCounts>(
    `SELECT
       (SELECT count(*)::int FROM classes c WHERE c.department_id = $1) AS classes,
       (SELECT count(DISTINCT e.student_user_id)::int
          FROM enrollments e
          JOIN classes c ON c.id = e.class_id
         WHERE c.department_id = $1 AND e.unenrolled_at IS NULL) AS students,
       (SELECT count(DISTINCT cf.faculty_user_id)::int
          FROM class_faculty cf
          JOIN classes c ON c.id = cf.class_id
         WHERE c.department_id = $1 AND cf.unassigned_at IS NULL) AS faculty`,
    [departmentId],
  );
  return expectRow(rows[0], 'departments: overview counts');
}
