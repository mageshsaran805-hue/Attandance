import { env } from '../config/env.js';
import { getPool } from '../db/pool.js';
import type { AttendanceStatus, SessionStatus } from './attendance.js';
import { getClassDetails, type ClassDetails, type DepartmentSummary } from './classes.js';
import { getDepartmentById } from './departments.js';

/**
 * Attendance reporting queries (Phase 5).
 *
 * Percentage convention: only closed sessions count toward present/absent
 * totals. Sessions that are still open appear in listings with their pending
 * count, but are excluded from percentages so the session that is running
 * right now can never drag a percentage down. A percentage is
 * present / (present + absent) rounded to one decimal, or null when the range
 * contains no settled records at all.
 */

export interface ReportTotals {
  /** Sessions of any status in the range. */
  sessions: number;
  /** Closed sessions in the range: the ones percentages are based on. */
  settledSessions: number;
  present: number;
  absent: number;
  percentage: number | null;
}

export interface ReportSessionEntry {
  id: string;
  sessionDate: string;
  status: SessionStatus;
  present: number;
  absent: number;
  /** Actively enrolled students without a record (only meaningful while open). */
  pending: number;
}

export interface ReportStudentEntry {
  studentUserId: string;
  fullName: string;
  email: string;
  isActive: boolean;
  present: number;
  absent: number;
  percentage: number | null;
}

export interface ClassReport {
  class: ClassDetails;
  from: string;
  to: string;
  totals: ReportTotals;
  students: ReportStudentEntry[];
  sessions: ReportSessionEntry[];
}

export interface DepartmentReportClassEntry extends ReportTotals {
  classId: string;
  className: string;
  academicYear: string;
  studentCount: number;
}

export interface DepartmentReport {
  department: DepartmentSummary;
  from: string;
  to: string;
  totals: ReportTotals;
  classes: DepartmentReportClassEntry[];
}

export interface SystemReportDepartmentEntry extends ReportTotals {
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  classCount: number;
  studentCount: number;
}

export interface SystemReportClassEntry extends ReportTotals {
  classId: string;
  className: string;
  academicYear: string;
  studentCount: number;
  department: DepartmentSummary;
}

export interface SystemReport {
  from: string;
  to: string;
  totals: ReportTotals;
  departments: SystemReportDepartmentEntry[];
  classes: SystemReportClassEntry[];
}

export interface StudentHistoryEntry {
  sessionId: string;
  classId: string;
  className: string;
  sessionDate: string;
  sessionStatus: SessionStatus;
  /** null while the session is open and the student has not marked yet. */
  status: AttendanceStatus | null;
  method: 'otp' | 'manual' | null;
  markedAt: string | null;
}

export interface StudentHistoryReport {
  from: string;
  to: string;
  totals: ReportTotals;
  sessions: StudentHistoryEntry[];
}

/** present / (present + absent) as a percentage with one decimal. */
export function percentageOf(present: number, absent: number): number | null {
  const total = present + absent;
  if (total === 0) {
    return null;
  }
  return Math.round((present / total) * 1000) / 10;
}

interface SessionTotalsInput {
  sessions: number;
  settledSessions: number;
  present: number;
  absent: number;
}

function sumTotals(rows: ReadonlyArray<SessionTotalsInput>): ReportTotals {
  let sessions = 0;
  let settledSessions = 0;
  let present = 0;
  let absent = 0;
  for (const row of rows) {
    sessions += row.sessions;
    settledSessions += row.settledSessions;
    present += row.present;
    absent += row.absent;
  }
  return { sessions, settledSessions, present, absent, percentage: percentageOf(present, absent) };
}

interface DbSessionRow {
  id: string;
  session_date: string;
  status: SessionStatus;
  present: number;
  absent: number;
  enrolled: number;
}

interface DbStudentRow {
  student_user_id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  present: number;
  absent: number;
}

interface DbDepartmentClassRow {
  id: string;
  name: string;
  academic_year: string;
  student_count: number;
  sessions: number;
  settled_sessions: number;
  present: number;
  absent: number;
}

interface DbSystemDepartmentRow extends DbDepartmentClassRow {
  code: string;
  class_count: number;
}

interface DbSystemClassRow {
  id: string;
  name: string;
  academic_year: string;
  department_id: string;
  department_name: string;
  department_code: string;
  student_count: number;
  sessions: number;
  settled_sessions: number;
  present: number;
  absent: number;
}

interface DbStudentHistoryRow {
  session_id: string;
  class_id: string;
  class_name: string;
  session_date: string;
  session_status: SessionStatus;
  record_status: AttendanceStatus | null;
  record_method: 'otp' | 'manual' | null;
  marked_at: Date | null;
}

const CLASS_SESSIONS_SQL = `
  SELECT s.id,
         s.session_date::text AS session_date,
         s.status,
         (SELECT count(*)::int FROM attendance_records r
           WHERE r.session_id = s.id AND r.status = 'present') AS present,
         (SELECT count(*)::int FROM attendance_records r
           WHERE r.session_id = s.id AND r.status = 'absent') AS absent,
         (SELECT count(*)::int FROM enrollments e
           WHERE e.class_id = s.class_id AND e.unenrolled_at IS NULL) AS enrolled
    FROM attendance_sessions s
   WHERE s.class_id = $1
     AND s.session_date BETWEEN $2::date AND $3::date
   ORDER BY s.session_date DESC, s.id`;

/**
 * Roster for the class report: every currently enrolled student plus anyone
 * who has a settled record in the range (so a student who left mid-term still
 * shows their history). Counts only cover closed sessions.
 */
const CLASS_STUDENTS_SQL = `
  WITH settled AS (
    SELECT r.student_user_id, r.status
      FROM attendance_records r
      JOIN attendance_sessions s ON s.id = r.session_id
     WHERE s.class_id = $1
       AND s.status = 'closed'
       AND s.session_date BETWEEN $2::date AND $3::date
  ),
  relevant_students AS (
    SELECT e.student_user_id
      FROM enrollments e
     WHERE e.class_id = $1 AND e.unenrolled_at IS NULL
    UNION
    SELECT student_user_id FROM settled
  )
  SELECT u.id AS student_user_id, u.full_name, u.email, u.is_active,
         count(settled.status) FILTER (WHERE settled.status = 'present')::int AS present,
         count(settled.status) FILTER (WHERE settled.status = 'absent')::int AS absent
    FROM users u
    JOIN relevant_students rs ON rs.student_user_id = u.id
    LEFT JOIN settled ON settled.student_user_id = u.id
   GROUP BY u.id, u.full_name, u.email, u.is_active
   ORDER BY u.full_name, u.email`;

/**
 * Per-class aggregates. DISTINCT keeps session counts correct despite the
 * records join; record counts would otherwise multiply per row.
 */
const CLASS_AGGREGATES_SQL = `
  SELECT s.class_id,
         count(DISTINCT s.id) AS sessions,
         count(DISTINCT s.id) FILTER (WHERE s.status = 'closed') AS settled_sessions,
         count(r.id) FILTER (WHERE s.status = 'closed' AND r.status = 'present') AS present,
         count(r.id) FILTER (WHERE s.status = 'closed' AND r.status = 'absent') AS absent
    FROM attendance_sessions s
    LEFT JOIN attendance_records r ON r.session_id = s.id
   WHERE s.session_date BETWEEN $1::date AND $2::date
   GROUP BY s.class_id`;

const DEPARTMENT_CLASSES_SQL = `
  SELECT c.id, c.name, c.academic_year,
         (SELECT count(*)::int FROM enrollments e
           WHERE e.class_id = c.id AND e.unenrolled_at IS NULL) AS student_count,
         COALESCE(a.sessions, 0)::int AS sessions,
         COALESCE(a.settled_sessions, 0)::int AS settled_sessions,
         COALESCE(a.present, 0)::int AS present,
         COALESCE(a.absent, 0)::int AS absent
    FROM classes c
    LEFT JOIN (${CLASS_AGGREGATES_SQL}) a ON a.class_id = c.id
   WHERE c.department_id = $3
   ORDER BY c.name, c.academic_year`;

const SYSTEM_DEPARTMENTS_SQL = `
  SELECT d.id, d.name, d.code,
         (SELECT count(*)::int FROM classes c WHERE c.department_id = d.id) AS class_count,
         (SELECT count(*)::int FROM enrollments e
            JOIN classes c ON c.id = e.class_id
           WHERE c.department_id = d.id AND e.unenrolled_at IS NULL) AS student_count,
         COALESCE(a.sessions, 0)::int AS sessions,
         COALESCE(a.settled_sessions, 0)::int AS settled_sessions,
         COALESCE(a.present, 0)::int AS present,
         COALESCE(a.absent, 0)::int AS absent
    FROM departments d
    LEFT JOIN (
      SELECT c.department_id,
             count(DISTINCT s.id) AS sessions,
             count(DISTINCT s.id) FILTER (WHERE s.status = 'closed') AS settled_sessions,
             count(r.id) FILTER (WHERE s.status = 'closed' AND r.status = 'present') AS present,
             count(r.id) FILTER (WHERE s.status = 'closed' AND r.status = 'absent') AS absent
        FROM attendance_sessions s
        JOIN classes c ON c.id = s.class_id
        LEFT JOIN attendance_records r ON r.session_id = s.id
       WHERE s.session_date BETWEEN $1::date AND $2::date
       GROUP BY c.department_id
    ) a ON a.department_id = d.id
   ORDER BY d.name`;

const SYSTEM_CLASSES_SQL = `
  SELECT c.id, c.name, c.academic_year,
         d.id AS department_id, d.name AS department_name, d.code AS department_code,
         (SELECT count(*)::int FROM enrollments e
           WHERE e.class_id = c.id AND e.unenrolled_at IS NULL) AS student_count,
         COALESCE(a.sessions, 0)::int AS sessions,
         COALESCE(a.settled_sessions, 0)::int AS settled_sessions,
         COALESCE(a.present, 0)::int AS present,
         COALESCE(a.absent, 0)::int AS absent
    FROM classes c
    JOIN departments d ON d.id = c.department_id
    LEFT JOIN (${CLASS_AGGREGATES_SQL}) a ON a.class_id = c.id
   ORDER BY d.name, c.name, c.academic_year`;

/**
 * A student's own history: sessions during their enrollment windows (per
 * enrollment row, so re-enrollment works) plus any session they have a record
 * for, even after unenrolling.
 */
const STUDENT_HISTORY_SQL = `
  SELECT s.id AS session_id, c.id AS class_id, c.name AS class_name,
         s.session_date::text AS session_date, s.status AS session_status,
         r.status AS record_status, r.method AS record_method, r.marked_at
    FROM attendance_sessions s
    JOIN classes c ON c.id = s.class_id
    LEFT JOIN attendance_records r ON r.session_id = s.id AND r.student_user_id = $1
   WHERE s.session_date BETWEEN $2::date AND $3::date
     AND (r.id IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM enrollments e
             WHERE e.class_id = s.class_id
               AND e.student_user_id = $1
               AND (e.enrolled_at AT TIME ZONE $4::text)::date <= s.session_date
               AND (e.unenrolled_at IS NULL
                    OR (e.unenrolled_at AT TIME ZONE $4::text)::date >= s.session_date)
          ))
   ORDER BY s.session_date DESC, c.name, s.id`;

export async function getClassReport(
  classId: string,
  from: string,
  to: string,
): Promise<ClassReport | null> {
  const classDetails = await getClassDetails(classId);
  if (!classDetails) {
    return null;
  }

  const pool = getPool();
  const [sessionResult, studentResult] = await Promise.all([
    pool.query<DbSessionRow>(CLASS_SESSIONS_SQL, [classId, from, to]),
    pool.query<DbStudentRow>(CLASS_STUDENTS_SQL, [classId, from, to]),
  ]);

  const students: ReportStudentEntry[] = studentResult.rows.map((row) => ({
    studentUserId: row.student_user_id,
    fullName: row.full_name,
    email: row.email,
    isActive: row.is_active,
    present: row.present,
    absent: row.absent,
    percentage: percentageOf(row.present, row.absent),
  }));

  const sessions: ReportSessionEntry[] = sessionResult.rows.map((row) => ({
    id: row.id,
    sessionDate: row.session_date,
    status: row.status,
    present: row.present,
    absent: row.absent,
    pending: Math.max(0, row.enrolled - row.present - row.absent),
  }));

  const present = students.reduce((sum, student) => sum + student.present, 0);
  const absent = students.reduce((sum, student) => sum + student.absent, 0);

  return {
    class: classDetails,
    from,
    to,
    totals: {
      sessions: sessions.length,
      settledSessions: sessions.filter((session) => session.status === 'closed').length,
      present,
      absent,
      percentage: percentageOf(present, absent),
    },
    students,
    sessions,
  };
}

export async function getDepartmentReport(
  departmentId: string,
  from: string,
  to: string,
): Promise<DepartmentReport | null> {
  const department = await getDepartmentById(departmentId);
  if (!department) {
    return null;
  }

  const { rows } = await getPool().query<DbDepartmentClassRow>(DEPARTMENT_CLASSES_SQL, [
    from,
    to,
    departmentId,
  ]);

  const classes: DepartmentReportClassEntry[] = rows.map((row) => ({
    classId: row.id,
    className: row.name,
    academicYear: row.academic_year,
    studentCount: row.student_count,
    sessions: row.sessions,
    settledSessions: row.settled_sessions,
    present: row.present,
    absent: row.absent,
    percentage: percentageOf(row.present, row.absent),
  }));

  return {
    department: { id: department.id, name: department.name, code: department.code },
    from,
    to,
    totals: sumTotals(classes),
    classes,
  };
}

export async function getSystemReport(from: string, to: string): Promise<SystemReport> {
  const pool = getPool();
  const [departmentResult, classResult] = await Promise.all([
    pool.query<DbSystemDepartmentRow>(SYSTEM_DEPARTMENTS_SQL, [from, to]),
    pool.query<DbSystemClassRow>(SYSTEM_CLASSES_SQL, [from, to]),
  ]);

  const departments: SystemReportDepartmentEntry[] = departmentResult.rows.map((row) => ({
    departmentId: row.id,
    departmentName: row.name,
    departmentCode: row.code,
    classCount: row.class_count,
    studentCount: row.student_count,
    sessions: row.sessions,
    settledSessions: row.settled_sessions,
    present: row.present,
    absent: row.absent,
    percentage: percentageOf(row.present, row.absent),
  }));

  const classes: SystemReportClassEntry[] = classResult.rows.map((row) => ({
    classId: row.id,
    className: row.name,
    academicYear: row.academic_year,
    studentCount: row.student_count,
    department: { id: row.department_id, name: row.department_name, code: row.department_code },
    sessions: row.sessions,
    settledSessions: row.settled_sessions,
    present: row.present,
    absent: row.absent,
    percentage: percentageOf(row.present, row.absent),
  }));

  return { from, to, totals: sumTotals(departments), departments, classes };
}

export async function getStudentHistory(
  studentUserId: string,
  from: string,
  to: string,
): Promise<StudentHistoryReport> {
  const { rows } = await getPool().query<DbStudentHistoryRow>(STUDENT_HISTORY_SQL, [
    studentUserId,
    from,
    to,
    env.APP_TIMEZONE,
  ]);

  const sessions: StudentHistoryEntry[] = rows.map((row) => ({
    sessionId: row.session_id,
    classId: row.class_id,
    className: row.class_name,
    sessionDate: row.session_date,
    sessionStatus: row.session_status,
    status: row.record_status,
    method: row.record_method,
    markedAt: row.marked_at === null ? null : new Date(row.marked_at).toISOString(),
  }));

  let present = 0;
  let absent = 0;
  let settledSessions = 0;
  for (const session of sessions) {
    if (session.sessionStatus !== 'closed') {
      continue;
    }
    settledSessions += 1;
    if (session.status === 'present') {
      present += 1;
    }
    if (session.status === 'absent') {
      absent += 1;
    }
  }

  return {
    from,
    to,
    totals: {
      sessions: sessions.length,
      settledSessions,
      present,
      absent,
      percentage: percentageOf(present, absent),
    },
    sessions,
  };
}
