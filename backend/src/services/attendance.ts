import type { Pool, PoolClient } from 'pg';
import { getPool } from '../db/pool.js';
import { expectRow } from '../lib/errors.js';

/**
 * Attendance session and record queries.
 *
 * Pending is represented by the absence of a row in attendance_records while
 * the session is open; closing materializes 'absent' records for everyone
 * still pending (see materializeAbsentStudents). OTP values are only ever
 * stored as HMAC hashes (see lib/otp.ts), never in plaintext.
 */

export type SessionStatus = 'open' | 'closed';
export type AttendanceStatus = 'present' | 'absent';
export type MarkMethod = 'otp' | 'manual';

export interface AttendanceCounts {
  enrolled: number;
  present: number;
  absent: number;
  pending: number;
}

export interface AttendanceSessionSummary {
  id: string;
  classId: string;
  className: string;
  sessionDate: string;
  status: SessionStatus;
  otpExpiresAt: string | null;
  otpActive: boolean;
  startedByUserId: string;
  startedByName: string;
  closedByUserId: string | null;
  closedByName: string | null;
  closedAt: string | null;
  createdAt: string;
  counts: AttendanceCounts;
}

export interface SessionStudentAttendance {
  studentUserId: string;
  fullName: string;
  email: string;
  isActive: boolean;
  status: AttendanceStatus | null;
  method: MarkMethod | null;
  markedAt: string | null;
  updatedAt: string | null;
}

export interface AttendanceRecordRow {
  id: string;
  sessionId: string;
  studentUserId: string;
  status: AttendanceStatus;
  method: MarkMethod;
  markedByUserId: string | null;
  markedAt: string;
  updatedAt: string;
}

/** Session as visible to one student, including the OTP state for marking. */
export interface StudentMarkSession {
  id: string;
  classId: string;
  sessionDate: string;
  status: SessionStatus;
  otpHash: string | null;
  otpExpiresAt: string | null;
}

export interface StudentTodayEntry {
  class: {
    id: string;
    name: string;
    academicYear: string;
    department: { id: string; name: string; code: string };
  };
  session: {
    id: string;
    status: SessionStatus;
    sessionDate: string;
    otpActive: boolean;
    otpExpiresAt: string | null;
  } | null;
  record: { status: AttendanceStatus; method: MarkMethod; markedAt: string } | null;
}

interface DbSessionSummaryRow {
  id: string;
  class_id: string;
  class_name: string;
  session_date: string;
  status: SessionStatus;
  otp_expires_at: string | null;
  started_by: string;
  started_by_name: string;
  closed_by: string | null;
  closed_by_name: string | null;
  closed_at: string | null;
  created_at: string;
  enrolled_count: number;
  present_count: number;
  absent_count: number;
}

interface DbSessionStudentRow {
  student_user_id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  status: AttendanceStatus | null;
  method: MarkMethod | null;
  marked_at: string | null;
  updated_at: string | null;
}

interface DbAttendanceRecordRow {
  id: string;
  session_id: string;
  student_user_id: string;
  status: AttendanceStatus;
  method: MarkMethod;
  marked_by: string | null;
  marked_at: string;
  updated_at: string;
}

interface DbStudentTodayRow {
  class_id: string;
  class_name: string;
  academic_year: string;
  department_id: string;
  department_name: string;
  department_code: string;
  session_id: string | null;
  session_status: SessionStatus | null;
  session_date: string | null;
  otp_expires_at: string | null;
  has_otp: boolean | null;
  record_status: AttendanceStatus | null;
  record_method: MarkMethod | null;
  record_marked_at: string | null;
}

const RECORD_COLUMNS = 'id, session_id, student_user_id, status, method, marked_by, marked_at, updated_at';

/**
 * One session summary row with live counts. `pending` is derived: enrolled
 * students without a record yet. A late enrollment after a session closed can
 * make pending positive for a closed session, which is why pending is clamped
 * at zero instead of computed as enrolled - present - absent exactly.
 */
const SESSION_SUMMARY_SQL = `
  SELECT s.id, s.class_id, c.name AS class_name, s.session_date::text AS session_date,
         s.status, s.otp_expires_at,
         s.started_by, su.full_name AS started_by_name,
         s.closed_by, cu.full_name AS closed_by_name, s.closed_at, s.created_at,
         (SELECT count(*)::int FROM enrollments e
           WHERE e.class_id = s.class_id AND e.unenrolled_at IS NULL) AS enrolled_count,
         (SELECT count(*)::int FROM attendance_records r
           WHERE r.session_id = s.id AND r.status = 'present') AS present_count,
         (SELECT count(*)::int FROM attendance_records r
           WHERE r.session_id = s.id AND r.status = 'absent') AS absent_count
    FROM attendance_sessions s
    JOIN classes c ON c.id = s.class_id
    JOIN users su ON su.id = s.started_by
    LEFT JOIN users cu ON cu.id = s.closed_by`;

function isOtpActive(status: SessionStatus, expiresAt: string | null): boolean {
  return status === 'open' && expiresAt !== null && new Date(expiresAt).getTime() > Date.now();
}

function mapSessionSummary(row: DbSessionSummaryRow): AttendanceSessionSummary {
  return {
    id: row.id,
    classId: row.class_id,
    className: row.class_name,
    sessionDate: row.session_date,
    status: row.status,
    otpExpiresAt: row.otp_expires_at,
    otpActive: isOtpActive(row.status, row.otp_expires_at),
    startedByUserId: row.started_by,
    startedByName: row.started_by_name,
    closedByUserId: row.closed_by,
    closedByName: row.closed_by_name,
    closedAt: row.closed_at,
    createdAt: row.created_at,
    counts: {
      enrolled: row.enrolled_count,
      present: row.present_count,
      absent: row.absent_count,
      pending: Math.max(0, row.enrolled_count - row.present_count - row.absent_count),
    },
  };
}

export async function getSessionSummaryById(
  sessionId: string,
  client?: Pool | PoolClient,
): Promise<AttendanceSessionSummary | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbSessionSummaryRow>(
    `${SESSION_SUMMARY_SQL} WHERE s.id = $1`,
    [sessionId],
  );
  const row = rows[0];
  return row ? mapSessionSummary(row) : null;
}

export async function findSessionForClassDate(
  classId: string,
  sessionDate: string,
  client?: Pool | PoolClient,
): Promise<AttendanceSessionSummary | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbSessionSummaryRow>(
    `${SESSION_SUMMARY_SQL} WHERE s.class_id = $1 AND s.session_date = $2`,
    [classId, sessionDate],
  );
  const row = rows[0];
  return row ? mapSessionSummary(row) : null;
}

/**
 * Sessions scoped to a faculty member's active assignments; null means the
 * caller may not see the session (routes answer 404 to avoid leaking it).
 */
export async function getSessionForFaculty(
  sessionId: string,
  facultyUserId: string,
): Promise<AttendanceSessionSummary | null> {
  const { rows } = await getPool().query<DbSessionSummaryRow>(
    `${SESSION_SUMMARY_SQL}
       JOIN class_faculty cf
         ON cf.class_id = s.class_id AND cf.faculty_user_id = $2 AND cf.unassigned_at IS NULL
      WHERE s.id = $1`,
    [sessionId, facultyUserId],
  );
  const row = rows[0];
  return row ? mapSessionSummary(row) : null;
}

/** Most recent sessions of a class, strictly before `beforeDate` when given. */
export async function listRecentSessionsForClass(
  classId: string,
  beforeDate: string | null,
  limit = 10,
): Promise<AttendanceSessionSummary[]> {
  const { rows } = await getPool().query<DbSessionSummaryRow>(
    `${SESSION_SUMMARY_SQL}
      WHERE s.class_id = $1 AND ($2::date IS NULL OR s.session_date < $2)
      ORDER BY s.session_date DESC
      LIMIT $3`,
    [classId, beforeDate, limit],
  );
  return rows.map(mapSessionSummary);
}

export async function openSession(
  input: {
    classId: string;
    sessionDate: string;
    otpHash: string;
    otpTtlMinutes: number;
    startedBy: string;
  },
  client: PoolClient,
): Promise<AttendanceSessionSummary> {
  const { rows } = await client.query<{ id: string }>(
    // Expiry is computed with the database clock so the lockout window
    // (otp_expires_at - TTL, see countFailedOtpAttempts) lines up with
    // otp_attempts.attempted_at even if app and database clocks differ.
    `INSERT INTO attendance_sessions (class_id, session_date, otp_hash, otp_expires_at, started_by)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4), $5)
     RETURNING id`,
    [input.classId, input.sessionDate, input.otpHash, input.otpTtlMinutes, input.startedBy],
  );
  const id = expectRow(rows[0], 'attendance_sessions: insert').id;
  const session = await getSessionSummaryById(id, client);
  if (session === null) {
    throw new Error('attendance_sessions: summary missing right after insert');
  }
  return session;
}

/**
 * Replaces the OTP while the session is open and returns the new expiry.
 * Null means the session was already closed.
 */
export async function updateSessionOtp(
  sessionId: string,
  otpHash: string,
  otpTtlMinutes: number,
  client: Pool | PoolClient,
): Promise<string | null> {
  const { rows } = await client.query<{ otp_expires_at: string }>(
    `UPDATE attendance_sessions
        SET otp_hash = $2, otp_expires_at = now() + make_interval(mins => $3)
      WHERE id = $1 AND status = 'open'
      RETURNING otp_expires_at`,
    [sessionId, otpHash, otpTtlMinutes],
  );
  const row = rows[0];
  return row ? row.otp_expires_at : null;
}

/** True when this call closed the session; false when it was already closed. */
export async function closeSession(
  sessionId: string,
  closedBy: string,
  client: PoolClient,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `UPDATE attendance_sessions
        SET status = 'closed', closed_by = $2, closed_at = now()
      WHERE id = $1 AND status = 'open'`,
    [sessionId, closedBy],
  );
  return rowCount === 1;
}

/**
 * Marks every actively enrolled student without a record as absent (method
 * 'manual', actor = closing faculty). Idempotent via the unique constraint;
 * returns how many records were created.
 */
export async function materializeAbsentStudents(
  sessionId: string,
  actorUserId: string,
  client: PoolClient,
): Promise<number> {
  const { rowCount } = await client.query(
    `INSERT INTO attendance_records (session_id, student_user_id, status, method, marked_by)
     SELECT $1, e.student_user_id, 'absent', 'manual', $2
       FROM attendance_sessions s
       JOIN enrollments e ON e.class_id = s.class_id AND e.unenrolled_at IS NULL
      WHERE s.id = $1
     ON CONFLICT (session_id, student_user_id) DO NOTHING`,
    [sessionId, actorUserId],
  );
  return rowCount ?? 0;
}

export async function listSessionStudents(
  sessionId: string,
  classId: string,
): Promise<SessionStudentAttendance[]> {
  const { rows } = await getPool().query<DbSessionStudentRow>(
    `SELECT u.id AS student_user_id, u.full_name, u.email, u.is_active,
            r.status, r.method, r.marked_at, r.updated_at
       FROM enrollments e
       JOIN users u ON u.id = e.student_user_id
       LEFT JOIN attendance_records r
         ON r.session_id = $1 AND r.student_user_id = e.student_user_id
      WHERE e.class_id = $2 AND e.unenrolled_at IS NULL
     UNION
     SELECT u.id AS student_user_id, u.full_name, u.email, u.is_active,
            r.status, r.method, r.marked_at, r.updated_at
       FROM attendance_records r
       JOIN users u ON u.id = r.student_user_id
      WHERE r.session_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM enrollments e2
           WHERE e2.class_id = $2 AND e2.student_user_id = r.student_user_id
             AND e2.unenrolled_at IS NULL
        )
      ORDER BY full_name`,
    [sessionId, classId],
  );
  return rows.map((row) => ({
    studentUserId: row.student_user_id,
    fullName: row.full_name,
    email: row.email,
    isActive: row.is_active,
    status: row.status,
    method: row.method,
    markedAt: row.marked_at,
    updatedAt: row.updated_at,
  }));
}

/** Session scoped to a student's own active enrollment (null = 404 later). */
export async function findSessionForStudentMark(
  sessionId: string,
  studentUserId: string,
): Promise<StudentMarkSession | null> {
  const { rows } = await getPool().query<{
    id: string;
    class_id: string;
    session_date: string;
    status: SessionStatus;
    otp_hash: string | null;
    otp_expires_at: string | null;
  }>(
    `SELECT s.id, s.class_id, s.session_date::text AS session_date, s.status,
            s.otp_hash, s.otp_expires_at
       FROM attendance_sessions s
       JOIN enrollments e
         ON e.class_id = s.class_id AND e.student_user_id = $2 AND e.unenrolled_at IS NULL
      WHERE s.id = $1`,
    [sessionId, studentUserId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    classId: row.class_id,
    sessionDate: row.session_date,
    status: row.status,
    otpHash: row.otp_hash,
    otpExpiresAt: row.otp_expires_at,
  };
}

export async function getStudentToday(
  studentUserId: string,
  sessionDate: string,
): Promise<StudentTodayEntry[]> {
  const { rows } = await getPool().query<DbStudentTodayRow>(
    `SELECT c.id AS class_id, c.name AS class_name, c.academic_year,
            d.id AS department_id, d.name AS department_name, d.code AS department_code,
            s.id AS session_id, s.status AS session_status, s.session_date::text AS session_date,
            s.otp_expires_at, (s.otp_hash IS NOT NULL) AS has_otp,
            r.status AS record_status, r.method AS record_method, r.marked_at AS record_marked_at
       FROM enrollments e
       JOIN classes c ON c.id = e.class_id
       JOIN departments d ON d.id = c.department_id
       LEFT JOIN attendance_sessions s
         ON s.class_id = c.id AND s.session_date = $2
       LEFT JOIN attendance_records r
         ON r.session_id = s.id AND r.student_user_id = e.student_user_id
      WHERE e.student_user_id = $1 AND e.unenrolled_at IS NULL
      ORDER BY c.name`,
    [studentUserId, sessionDate],
  );

  return rows.map((row) => ({
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
    session:
      row.session_id !== null && row.session_status !== null && row.session_date !== null
        ? {
            id: row.session_id,
            status: row.session_status,
            sessionDate: row.session_date,
            otpActive:
              row.has_otp === true && isOtpActive(row.session_status, row.otp_expires_at),
            otpExpiresAt: row.otp_expires_at,
          }
        : null,
    record:
      row.record_status !== null && row.record_method !== null && row.record_marked_at !== null
        ? {
            status: row.record_status,
            method: row.record_method,
            markedAt: row.record_marked_at,
          }
        : null,
  }));
}

export async function findRecord(
  sessionId: string,
  studentUserId: string,
  client?: Pool | PoolClient,
): Promise<AttendanceRecordRow | null> {
  const db = client ?? getPool();
  const { rows } = await db.query<DbAttendanceRecordRow>(
    `SELECT ${RECORD_COLUMNS} FROM attendance_records
      WHERE session_id = $1 AND student_user_id = $2`,
    [sessionId, studentUserId],
  );
  const row = rows[0];
  return row ? mapRecord(row) : null;
}

/**
 * OTP self-marking: inserts a present/otp record. Returns null when a record
 * already exists (the student cannot mark twice).
 */
export async function insertOtpMark(
  sessionId: string,
  studentUserId: string,
  client: PoolClient,
): Promise<AttendanceRecordRow | null> {
  const { rows } = await client.query<DbAttendanceRecordRow>(
    `INSERT INTO attendance_records (session_id, student_user_id, status, method)
     VALUES ($1, $2, 'present', 'otp')
     ON CONFLICT (session_id, student_user_id) DO NOTHING
     RETURNING ${RECORD_COLUMNS}`,
    [sessionId, studentUserId],
  );
  const row = rows[0];
  return row ? mapRecord(row) : null;
}

/**
 * Bulk manual mark/correction for every actively enrolled student of the
 * session's class (method 'manual', actor = acting faculty member). Existing
 * records are overwritten, including OTP self-marks, just like single
 * corrections. Idempotent per status; returns how many records were written.
 */
export async function markAllEnrolledStudents(
  sessionId: string,
  status: AttendanceStatus,
  actorUserId: string,
  client: PoolClient,
): Promise<number> {
  const { rowCount } = await client.query(
    `INSERT INTO attendance_records (session_id, student_user_id, status, method, marked_by)
     SELECT $1, e.student_user_id, $2, 'manual', $3
       FROM attendance_sessions s
       JOIN enrollments e ON e.class_id = s.class_id AND e.unenrolled_at IS NULL
      WHERE s.id = $1
     ON CONFLICT (session_id, student_user_id)
     DO UPDATE SET status = EXCLUDED.status, method = 'manual', marked_by = EXCLUDED.marked_by`,
    [sessionId, status, actorUserId],
  );
  return rowCount ?? 0;
}

/** Manual mark or correction; always records the acting user. */
export async function upsertManualMark(
  input: {
    sessionId: string;
    studentUserId: string;
    status: AttendanceStatus;
    actorUserId: string;
  },
  client: PoolClient,
): Promise<AttendanceRecordRow> {
  const { rows } = await client.query<DbAttendanceRecordRow>(
    `INSERT INTO attendance_records (session_id, student_user_id, status, method, marked_by)
     VALUES ($1, $2, $3, 'manual', $4)
     ON CONFLICT (session_id, student_user_id)
     DO UPDATE SET status = EXCLUDED.status, method = 'manual', marked_by = EXCLUDED.marked_by
     RETURNING ${RECORD_COLUMNS}`,
    [input.sessionId, input.studentUserId, input.status, input.actorUserId],
  );
  return mapRecord(expectRow(rows[0], 'attendance_records: upsert'));
}

export async function recordOtpAttempt(
  input: {
    sessionId: string;
    studentUserId: string;
    success: boolean;
    ip: string | null;
  },
  client?: Pool | PoolClient,
): Promise<void> {
  const db = client ?? getPool();
  await db.query(
    `INSERT INTO otp_attempts (session_id, student_user_id, success, ip)
     VALUES ($1, $2, $3, $4)`,
    [input.sessionId, input.studentUserId, input.success, input.ip],
  );
}

/**
 * Failed attempts against the current OTP generation. The generation started
 * at `otp_expires_at - OTP_TTL_MINUTES` (both from the database clock), so
 * regenerating the OTP moves the window forward and clears previous lockouts.
 */
export async function countFailedOtpAttempts(
  sessionId: string,
  studentUserId: string,
  otpTtlMinutes: number,
): Promise<number> {
  const { rows } = await getPool().query<{ count: number }>(
    `SELECT count(*)::int AS count
       FROM otp_attempts a
       JOIN attendance_sessions s ON s.id = a.session_id
      WHERE a.session_id = $1 AND a.student_user_id = $2
        AND a.success = false
        AND a.attempted_at >= s.otp_expires_at - make_interval(mins => $3)`,
    [sessionId, studentUserId, otpTtlMinutes],
  );
  return expectRow(rows[0], 'otp_attempts: count').count;
}

function mapRecord(row: DbAttendanceRecordRow): AttendanceRecordRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    studentUserId: row.student_user_id,
    status: row.status,
    method: row.method,
    markedByUserId: row.marked_by,
    markedAt: row.marked_at,
    updatedAt: row.updated_at,
  };
}
