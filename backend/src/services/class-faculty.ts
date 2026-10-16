import type { Pool, PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { expectRow } from '../lib/errors.js';

/**
 * Faculty assignment history (class_faculty). Rows are never deleted:
 * unassigning stamps `unassigned_at`, and reassigning creates a new row so
 * who was assigned, by whom, and when stays auditable.
 */

export interface ClassFacultyAssignment {
  id: string;
  classId: string;
  facultyUserId: string;
  assignedBy: string;
  assignedAt: string;
  unassignedAt: string | null;
}

export interface AssignmentDetails {
  id: string;
  classId: string;
  facultyUserId: string;
  fullName: string;
  email: string;
  assignedAt: string;
  unassignedAt: string | null;
}

export interface AssignmentScope {
  id: string;
  classId: string;
  facultyUserId: string;
  unassignedAt: string | null;
  departmentId: string;
}

export interface ClassAssignments {
  active: AssignmentDetails[];
  history: AssignmentDetails[];
}

interface DbClassFacultyRow {
  id: string;
  class_id: string;
  faculty_user_id: string;
  assigned_by: string;
  assigned_at: string;
  unassigned_at: string | null;
}

interface DbAssignmentDetailsRow {
  id: string;
  class_id: string;
  faculty_user_id: string;
  full_name: string;
  email: string;
  assigned_at: string;
  unassigned_at: string | null;
}

const CLASS_FACULTY_COLUMNS =
  'id, class_id, faculty_user_id, assigned_by, assigned_at, unassigned_at';

function mapAssignment(row: DbClassFacultyRow): ClassFacultyAssignment {
  return {
    id: row.id,
    classId: row.class_id,
    facultyUserId: row.faculty_user_id,
    assignedBy: row.assigned_by,
    assignedAt: row.assigned_at,
    unassignedAt: row.unassigned_at,
  };
}

/** Assignment joined with its class, for scope checks before mutations. */
export async function findAssignmentScope(
  assignmentId: string,
  client?: Pool | PoolClient,
): Promise<AssignmentScope | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<{
    id: string;
    class_id: string;
    faculty_user_id: string;
    unassigned_at: string | null;
    department_id: string;
  }>(
    `SELECT cf.id, cf.class_id, cf.faculty_user_id, cf.unassigned_at, c.department_id
       FROM class_faculty cf
       JOIN classes c ON c.id = cf.class_id
      WHERE cf.id = $1`,
    [assignmentId],
  );
  const row = rows[0];
  return row
    ? {
        id: row.id,
        classId: row.class_id,
        facultyUserId: row.faculty_user_id,
        unassignedAt: row.unassigned_at,
        departmentId: row.department_id,
      }
    : null;
}

export async function createAssignment(
  classId: string,
  facultyUserId: string,
  assignedBy: string,
  client?: Pool | PoolClient,
): Promise<ClassFacultyAssignment> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbClassFacultyRow>(
    `INSERT INTO class_faculty (class_id, faculty_user_id, assigned_by)
     VALUES ($1, $2, $3)
     RETURNING ${CLASS_FACULTY_COLUMNS}`,
    [classId, facultyUserId, assignedBy],
  );
  return mapAssignment(expectRow(rows[0], 'class_faculty: insert'));
}

/** Ends an active assignment; returns null when it was already ended. */
export async function endAssignment(
  assignmentId: string,
  client?: Pool | PoolClient,
): Promise<ClassFacultyAssignment | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbClassFacultyRow>(
    `UPDATE class_faculty SET unassigned_at = now()
      WHERE id = $1 AND unassigned_at IS NULL
      RETURNING ${CLASS_FACULTY_COLUMNS}`,
    [assignmentId],
  );
  const row = rows[0];
  return row ? mapAssignment(row) : null;
}

export async function listAssignmentsForClass(classId: string): Promise<ClassAssignments> {
  const { rows } = await getPool().query<DbAssignmentDetailsRow>(
    `SELECT cf.id, cf.class_id, cf.faculty_user_id, cf.assigned_at, cf.unassigned_at,
            fu.full_name, fu.email
       FROM class_faculty cf
       JOIN users fu ON fu.id = cf.faculty_user_id
      WHERE cf.class_id = $1
      ORDER BY cf.assigned_at DESC`,
    [classId],
  );

  const active: AssignmentDetails[] = [];
  const history: AssignmentDetails[] = [];
  for (const row of rows) {
    const entry: AssignmentDetails = {
      id: row.id,
      classId: row.class_id,
      facultyUserId: row.faculty_user_id,
      fullName: row.full_name,
      email: row.email,
      assignedAt: row.assigned_at,
      unassignedAt: row.unassigned_at,
    };
    (row.unassigned_at === null ? active : history).push(entry);
  }
  return { active, history };
}

export async function countActiveAssignmentsForFaculty(
  facultyUserId: string,
  client?: Pool | PoolClient,
): Promise<number> {
  const db = client ?? getPool();
  const { rows } = await db.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM class_faculty WHERE faculty_user_id = $1 AND unassigned_at IS NULL',
    [facultyUserId],
  );
  return expectRow(rows[0], 'class_faculty: count').count;
}
