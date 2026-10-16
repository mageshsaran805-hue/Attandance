import type { Pool, PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { expectRow } from '../lib/errors.js';

/**
 * Class queries plus the scope helpers that enforce access rules:
 * HODs may only act on classes of their department; faculty only on classes
 * they are actively assigned to. Out-of-scope classes come back as null so
 * routes can answer 404 without revealing that the class exists.
 */

export interface DepartmentSummary {
  id: string;
  name: string;
  code: string;
}

export interface ClassRow {
  id: string;
  departmentId: string;
  name: string;
  academicYear: string;
}

export interface ClassListEntry {
  id: string;
  name: string;
  academicYear: string;
  department: DepartmentSummary;
  studentCount: number;
  facultyCount: number;
}

export interface ClassDetails {
  id: string;
  name: string;
  academicYear: string;
  department: DepartmentSummary;
  studentCount: number;
}

export interface ClassFacultySummary {
  id: string;
  facultyUserId: string;
  fullName: string;
  email: string;
  assignedAt: string;
}

export interface HodClassEntry {
  id: string;
  name: string;
  academicYear: string;
  studentCount: number;
  faculty: ClassFacultySummary[];
}

interface DbClassRow {
  id: string;
  department_id: string;
  name: string;
  academic_year: string;
}

interface DbClassListRow {
  id: string;
  name: string;
  academic_year: string;
  department_id: string;
  department_name: string;
  department_code: string;
  student_count: number;
  faculty_count: number;
}

interface DbHodClassRow {
  id: string;
  name: string;
  academic_year: string;
  student_count: number;
  faculty: ClassFacultySummary[];
}

const CLASS_COLUMNS = 'id, department_id, name, academic_year';

const CLASS_LIST_SQL = `
  SELECT c.id, c.name, c.academic_year,
         d.id AS department_id, d.name AS department_name, d.code AS department_code,
         (SELECT count(*)::int FROM enrollments e
           WHERE e.class_id = c.id AND e.unenrolled_at IS NULL) AS student_count,
         (SELECT count(*)::int FROM class_faculty cf
           WHERE cf.class_id = c.id AND cf.unassigned_at IS NULL) AS faculty_count
    FROM classes c
    JOIN departments d ON d.id = c.department_id`;

function mapClass(row: DbClassRow): ClassRow {
  return {
    id: row.id,
    departmentId: row.department_id,
    name: row.name,
    academicYear: row.academic_year,
  };
}

function mapClassList(row: DbClassListRow): ClassListEntry {
  return {
    id: row.id,
    name: row.name,
    academicYear: row.academic_year,
    department: { id: row.department_id, name: row.department_name, code: row.department_code },
    studentCount: row.student_count,
    facultyCount: row.faculty_count,
  };
}

export async function listClassesWithDetails(): Promise<ClassListEntry[]> {
  const { rows } = await getPool().query<DbClassListRow>(`${CLASS_LIST_SQL} ORDER BY d.name, c.name`);
  return rows.map(mapClassList);
}

export async function getClassById(id: string, client?: Pool | PoolClient): Promise<ClassRow | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbClassRow>(
    `SELECT ${CLASS_COLUMNS} FROM classes WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? mapClass(row) : null;
}

export async function getClassDetails(id: string): Promise<ClassDetails | null> {
  const { rows } = await getPool().query<DbClassListRow>(`${CLASS_LIST_SQL} WHERE c.id = $1`, [id]);
  const row = rows[0];
  return row ? mapClassList(row) : null;
}

/** Class scoped to a department (HOD access check). */
export async function getClassForDepartment(
  classId: string,
  departmentId: string,
): Promise<ClassRow | null> {
  const { rows } = await getPool().query<DbClassRow>(
    `SELECT ${CLASS_COLUMNS} FROM classes WHERE id = $1 AND department_id = $2`,
    [classId, departmentId],
  );
  const row = rows[0];
  return row ? mapClass(row) : null;
}

/** Class scoped to a faculty member's active assignments (faculty access check). */
export async function getClassForFaculty(
  classId: string,
  facultyUserId: string,
): Promise<ClassRow | null> {
  const { rows } = await getPool().query<DbClassRow>(
    `SELECT c.id, c.department_id, c.name, c.academic_year
       FROM classes c
       JOIN class_faculty cf ON cf.class_id = c.id
      WHERE c.id = $1 AND cf.faculty_user_id = $2 AND cf.unassigned_at IS NULL`,
    [classId, facultyUserId],
  );
  const row = rows[0];
  return row ? mapClass(row) : null;
}

export async function listClassesForFaculty(facultyUserId: string): Promise<ClassListEntry[]> {
  const { rows } = await getPool().query<DbClassListRow>(
    `SELECT c.id, c.name, c.academic_year,
            d.id AS department_id, d.name AS department_name, d.code AS department_code,
            (SELECT count(*)::int FROM enrollments e
              WHERE e.class_id = c.id AND e.unenrolled_at IS NULL) AS student_count,
            0 AS faculty_count
       FROM classes c
       JOIN departments d ON d.id = c.department_id
       JOIN class_faculty cf ON cf.class_id = c.id
      WHERE cf.faculty_user_id = $1 AND cf.unassigned_at IS NULL
      ORDER BY c.name`,
    [facultyUserId],
  );
  return rows.map(mapClassList);
}

export async function listClassesForDepartment(departmentId: string): Promise<HodClassEntry[]> {
  const { rows } = await getPool().query<DbHodClassRow>(
    `SELECT c.id, c.name, c.academic_year,
            (SELECT count(*)::int FROM enrollments e
              WHERE e.class_id = c.id AND e.unenrolled_at IS NULL) AS student_count,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'id', cf.id,
                       'facultyUserId', cf.faculty_user_id,
                       'fullName', fu.full_name,
                       'email', fu.email,
                       'assignedAt', cf.assigned_at
                     ) ORDER BY fu.full_name)
                FROM class_faculty cf
                JOIN users fu ON fu.id = cf.faculty_user_id
               WHERE cf.class_id = c.id AND cf.unassigned_at IS NULL
            ), '[]'::json) AS faculty
       FROM classes c
      WHERE c.department_id = $1
      ORDER BY c.name`,
    [departmentId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    academicYear: row.academic_year,
    studentCount: row.student_count,
    faculty: row.faculty,
  }));
}

export async function createClass(
  input: { departmentId: string; name: string; academicYear: string },
  client?: Pool | PoolClient,
): Promise<ClassRow> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbClassRow>(
    `INSERT INTO classes (department_id, name, academic_year) VALUES ($1, $2, $3) RETURNING ${CLASS_COLUMNS}`,
    [input.departmentId, input.name, input.academicYear],
  );
  return mapClass(expectRow(rows[0], 'classes: insert'));
}

export async function updateClass(
  id: string,
  input: { name: string; academicYear: string },
  client?: Pool | PoolClient,
): Promise<ClassRow | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbClassRow>(
    `UPDATE classes SET name = $2, academic_year = $3 WHERE id = $1 RETURNING ${CLASS_COLUMNS}`,
    [id, input.name, input.academicYear],
  );
  const row = rows[0];
  return row ? mapClass(row) : null;
}

export async function countClasses(client?: Pool | PoolClient): Promise<number> {
  const db = client ?? getPool();
  const { rows } = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM classes');
  return expectRow(rows[0], 'classes: count').count;
}

// ---------------------------------------------------------------------------
// Public class choices (student self-registration form)
// ---------------------------------------------------------------------------

export interface PublicClassChoice {
  id: string;
  name: string;
  academicYear: string;
}

export interface PublicDepartmentChoice {
  id: string;
  name: string;
  code: string;
  classes: PublicClassChoice[];
}

interface DbPublicChoiceRow {
  department_id: string;
  department_name: string;
  department_code: string;
  class_id: string;
  class_name: string;
  academic_year: string;
}

/**
 * Departments with the classes a new student can choose, for the public
 * registration form. No counts or staff data are exposed.
 */
export async function listDepartmentsWithClasses(): Promise<PublicDepartmentChoice[]> {
  const { rows } = await getPool().query<DbPublicChoiceRow>(
    `SELECT d.id AS department_id, d.name AS department_name, d.code AS department_code,
            c.id AS class_id, c.name AS class_name, c.academic_year
       FROM departments d
       JOIN classes c ON c.department_id = d.id
      ORDER BY d.name, c.name`,
  );

  const departments = new Map<string, PublicDepartmentChoice>();
  for (const row of rows) {
    let department = departments.get(row.department_id);
    if (!department) {
      department = {
        id: row.department_id,
        name: row.department_name,
        code: row.department_code,
        classes: [],
      };
      departments.set(row.department_id, department);
    }
    department.classes.push({
      id: row.class_id,
      name: row.class_name,
      academicYear: row.academic_year,
    });
  }
  return [...departments.values()];
}
