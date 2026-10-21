import type { PoolClient } from 'pg';
import { ApiError } from '../lib/errors.js';
import { getClassById, type ClassRow } from './classes.js';

/**
 * Year-end class promotion.
 *
 * Promotion is an enrollment move, not a destructive update: active source
 * enrollments are closed with `unenrolled_at` (their history stays), and new
 * target enrollments are inserted. Attendance belongs to sessions, not to
 * enrollment rows, so every historical record remains untouched.
 */

interface DbPromotionCandidateRow {
  enrollment_id: string;
  student_user_id: string;
  is_active: boolean;
}

export interface ClassPromotionResult {
  sourceClass: ClassRow;
  targetClass: ClassRow;
  /** Students who received a new target enrollment in this call. */
  promotedStudentUserIds: string[];
  /** Active students who already had an active target enrollment. */
  alreadyEnrolledStudentUserIds: string[];
  /** Inactive accounts left in the source class for manual follow-up. */
  skippedInactiveStudentUserIds: string[];
}

/**
 * Promotes every actively enrolled student from one class to another class in
 * the same department. The caller owns the transaction so the enrollment
 * changes and the audit entry commit together.
 *
 * Rules:
 * - source and target must be different classes in the same department;
 * - neither class may have an open attendance session;
 * - inactive student accounts are skipped and reported, never enrolled;
 * - a student already active in the target only leaves the source class;
 * - concurrent enrollment into the target is treated as "already enrolled".
 */
export async function promoteClassStudents(
  sourceClassId: string,
  targetClassId: string,
  client: PoolClient,
): Promise<ClassPromotionResult> {
  if (sourceClassId === targetClassId) {
    throw new ApiError(400, 'Choose a different target class.');
  }

  // Lock both class rows in a stable order so two promotions touching the
  // same pair serialize instead of interleaving their enrollment changes.
  await client.query(
    'SELECT id FROM classes WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [[sourceClassId, targetClassId]],
  );

  const sourceClass = await getClassById(sourceClassId, client);
  if (!sourceClass) {
    throw new ApiError(404, 'Source class not found.');
  }
  const targetClass = await getClassById(targetClassId, client);
  if (!targetClass) {
    throw new ApiError(404, 'Target class not found.');
  }
  if (sourceClass.departmentId !== targetClass.departmentId) {
    throw new ApiError(400, 'Source and target classes must belong to the same department.');
  }

  // Promotion changes who belongs to each class, so it must not happen in the
  // middle of an open attendance session: closing that session later would
  // either miss promoted students (source) or mark new students absent for a
  // session they never attended (target).
  const { rows: openSessions } = await client.query<{ class_name: string }>(
    `SELECT c.name AS class_name
       FROM attendance_sessions s
       JOIN classes c ON c.id = s.class_id
      WHERE s.class_id = ANY($1::uuid[])
        AND s.status = 'open'
      ORDER BY c.name
      LIMIT 1`,
    [[sourceClassId, targetClassId]],
  );
  if (openSessions[0]) {
    throw new ApiError(
      409,
      `Close the open attendance session for "${openSessions[0].class_name}" before promoting students.`,
    );
  }

  // Lock the source enrollment rows so concurrent unenrolls cannot change the
  // set halfway through the promotion.
  const { rows } = await client.query<DbPromotionCandidateRow>(
    `SELECT e.id AS enrollment_id, e.student_user_id, u.is_active
       FROM enrollments e
       JOIN users u ON u.id = e.student_user_id
      WHERE e.class_id = $1
        AND e.unenrolled_at IS NULL
        AND u.role = 'student'
      ORDER BY e.id
        FOR UPDATE OF e`,
    [sourceClassId],
  );

  if (rows.length === 0) {
    throw new ApiError(409, 'The source class has no active students to promote.');
  }

  const activeCandidates = rows.filter((row) => row.is_active);
  const inactiveCandidates = rows.filter((row) => !row.is_active);
  if (activeCandidates.length === 0) {
    throw new ApiError(
      409,
      'The source class has no active student accounts to promote. Reactivate those accounts first.',
    );
  }

  const activeStudentIds = activeCandidates.map((row) => row.student_user_id);
  const { rows: existingTargetRows } = await client.query<{ student_user_id: string }>(
    `SELECT student_user_id
       FROM enrollments
      WHERE class_id = $1
        AND student_user_id = ANY($2::uuid[])
        AND unenrolled_at IS NULL
      FOR UPDATE`,
    [targetClassId, activeStudentIds],
  );
  const alreadyTargetIds = new Set(existingTargetRows.map((row) => row.student_user_id));
  const toInsert = activeCandidates.filter((row) => !alreadyTargetIds.has(row.student_user_id));

  let insertedRows: Array<{ student_user_id: string }> = [];
  if (toInsert.length > 0) {
    // ON CONFLICT covers a concurrent enrollment race; the returned rows are
    // the ones this promotion actually created.
    const { rows: inserted } = await client.query<{ student_user_id: string }>(
      `INSERT INTO enrollments (class_id, student_user_id)
       SELECT $1, candidate.student_user_id
         FROM unnest($2::uuid[]) AS candidate(student_user_id)
       ON CONFLICT (class_id, student_user_id) WHERE unenrolled_at IS NULL DO NOTHING
       RETURNING student_user_id`,
      [targetClassId, toInsert.map((row) => row.student_user_id)],
    );
    insertedRows = inserted;
  }

  // Every active student leaves the source, including those who were already
  // in the target. Inactive accounts stay in the source for manual follow-up.
  await client.query(
    `UPDATE enrollments
        SET unenrolled_at = now()
      WHERE id = ANY($1::uuid[])
        AND unenrolled_at IS NULL`,
    [activeCandidates.map((row) => row.enrollment_id)],
  );

  const insertedIds = new Set(insertedRows.map((row) => row.student_user_id));
  return {
    sourceClass,
    targetClass,
    promotedStudentUserIds: activeCandidates
      .filter((row) => insertedIds.has(row.student_user_id))
      .map((row) => row.student_user_id),
    alreadyEnrolledStudentUserIds: activeCandidates
      .filter((row) => !insertedIds.has(row.student_user_id))
      .map((row) => row.student_user_id),
    skippedInactiveStudentUserIds: inactiveCandidates.map((row) => row.student_user_id),
  };
}
