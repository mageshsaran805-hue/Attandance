import type { PoolClient } from 'pg';

/**
 * Administrative hard-delete cascades.
 *
 * The schema uses `ON DELETE RESTRICT` on purpose so ordinary operations never
 * silently destroy history. These functions are the one explicit exception:
 * an administrator may permanently remove an account, class or department.
 * Every dependency is cleared or reassigned inside the caller's transaction
 * before the target row is deleted, so the operation is all-or-nothing.
 *
 * Audit handling: rows tied to the deleted entity (and audit snapshots that
 * mention its id) are removed, because the administrator asked for a complete
 * wipe and because account emails must not survive in old snapshots. Audit
 * rows where the deleted user acted on other entities are kept with
 * `actor_user_id = NULL`. The route writes one final deletion event after the
 * cleanup; that event contains ids and counts, never an email or password.
 */

export interface ClassDeletionCounts {
  sessions: number;
  attendanceRecords: number;
  otpAttempts: number;
  enrollments: number;
  facultyAssignments: number;
  registrations: number;
}

export interface DepartmentDeletionCounts extends ClassDeletionCounts {
  classes: number;
}

export interface UserDeletionCounts {
  enrollments: number;
  attendanceRecords: number;
  otpAttempts: number;
  facultyAssignments: number;
  registrations: number;
  reassignedSessions: number;
  reassignedRecords: number;
  reassignedAssignments: number;
  reassignedRegistrations: number;
  reassignedCalendarEntries: number;
  clearedHodDepartments: number;
}

async function selectIds(
  client: PoolClient,
  sql: string,
  params: unknown[],
): Promise<string[]> {
  const { rows } = await client.query<{ id: string }>(sql, params);
  return rows.map((row) => row.id);
}

/**
 * Deletes audit rows whose entity id is in `ids`, plus rows whose JSON
 * snapshots mention one of those ids. UUID ids are used as literal
 * substrings, so this is safe (no wildcard interpretation).
 */
async function deleteAuditReferences(
  client: PoolClient,
  ids: string[],
  matchSnapshots: boolean,
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await client.query(
    `DELETE FROM audit_log
      WHERE entity_id = ANY($1::text[])
         OR ($2::boolean AND EXISTS (
              SELECT 1
                FROM unnest($1::text[]) AS target(id)
               WHERE old_value::text LIKE '%' || target.id || '%'
                  OR new_value::text LIKE '%' || target.id || '%'
            ))`,
    [ids, matchSnapshots],
  );
}

/** Removes audit snapshots that still contain an account email. */
async function deleteAuditByEmail(client: PoolClient, email: string): Promise<void> {
  await client.query(
    `DELETE FROM audit_log
      WHERE lower(new_value->>'email') = lower($1)
         OR lower(old_value->>'email') = lower($1)
         OR lower(new_value->>'attemptedEmail') = lower($1)
         OR lower(old_value->>'attemptedEmail') = lower($1)`,
    [email],
  );
}

/**
 * Permanently deletes one class and everything that depends on it.
 * Student and staff accounts are not deleted; only their links to this class
 * (enrollments, assignments, registrations and attendance rows) are.
 */
export async function deleteClassCascade(
  client: PoolClient,
  classId: string,
): Promise<ClassDeletionCounts | null> {
  const found = await client.query<{ id: string }>(
    'SELECT id FROM classes WHERE id = $1 FOR UPDATE',
    [classId],
  );
  if (!found.rows[0]) {
    return null;
  }

  const sessionIds = await selectIds(
    client,
    'SELECT id FROM attendance_sessions WHERE class_id = $1 FOR UPDATE',
    [classId],
  );
  const recordIds =
    sessionIds.length > 0
      ? await selectIds(
          client,
          'SELECT id FROM attendance_records WHERE session_id = ANY($1::uuid[])',
          [sessionIds],
        )
      : [];
  const enrollmentIds = await selectIds(
    client,
    'SELECT id FROM enrollments WHERE class_id = $1',
    [classId],
  );
  const assignmentIds = await selectIds(
    client,
    'SELECT id FROM class_faculty WHERE class_id = $1',
    [classId],
  );
  const registrationIds = await selectIds(
    client,
    'SELECT id FROM student_registrations WHERE class_id = $1',
    [classId],
  );

  const otpAttempts =
    sessionIds.length > 0
      ? ((
          await client.query('DELETE FROM otp_attempts WHERE session_id = ANY($1::uuid[])', [
            sessionIds,
          ])
        ).rowCount ?? 0)
      : 0;

  if (sessionIds.length > 0) {
    await client.query('DELETE FROM attendance_records WHERE session_id = ANY($1::uuid[])', [
      sessionIds,
    ]);
    await client.query('DELETE FROM attendance_sessions WHERE id = ANY($1::uuid[])', [sessionIds]);
  }
  await client.query('DELETE FROM class_faculty WHERE class_id = $1', [classId]);
  await client.query('DELETE FROM enrollments WHERE class_id = $1', [classId]);
  await client.query('DELETE FROM student_registrations WHERE class_id = $1', [classId]);

  await deleteAuditReferences(
    client,
    [
      classId,
      ...sessionIds,
      ...recordIds,
      ...enrollmentIds,
      ...assignmentIds,
      ...registrationIds,
    ],
    true,
  );
  await client.query('DELETE FROM classes WHERE id = $1', [classId]);

  return {
    sessions: sessionIds.length,
    attendanceRecords: recordIds.length,
    otpAttempts,
    enrollments: enrollmentIds.length,
    facultyAssignments: assignmentIds.length,
    registrations: registrationIds.length,
  };
}

/**
 * Permanently deletes a department and every class inside it. HOD and faculty
 * accounts are not deleted; the HOD link disappears with the department row.
 */
export async function deleteDepartmentCascade(
  client: PoolClient,
  departmentId: string,
): Promise<DepartmentDeletionCounts | null> {
  const found = await client.query<{ id: string }>(
    'SELECT id FROM departments WHERE id = $1 FOR UPDATE',
    [departmentId],
  );
  if (!found.rows[0]) {
    return null;
  }

  const classIds = await selectIds(client, 'SELECT id FROM classes WHERE department_id = $1', [
    departmentId,
  ]);
  const totals: DepartmentDeletionCounts = {
    classes: classIds.length,
    sessions: 0,
    attendanceRecords: 0,
    otpAttempts: 0,
    enrollments: 0,
    facultyAssignments: 0,
    registrations: 0,
  };

  for (const classId of classIds) {
    const counts = await deleteClassCascade(client, classId);
    if (counts) {
      totals.sessions += counts.sessions;
      totals.attendanceRecords += counts.attendanceRecords;
      totals.otpAttempts += counts.otpAttempts;
      totals.enrollments += counts.enrollments;
      totals.facultyAssignments += counts.facultyAssignments;
      totals.registrations += counts.registrations;
    }
  }

  await deleteAuditReferences(client, [departmentId], true);
  await client.query('DELETE FROM departments WHERE id = $1', [departmentId]);
  return totals;
}

/**
 * Permanently deletes one account and frees its email for reuse.
 *
 * References where the deleted user acted on data that should survive
 * (sessions they started, manual marks they made, calendar entries they
 * created, assignments they made, registrations they reviewed) are reassigned
 * to the administrator performing the deletion. Data owned by the deleted
 * account (student enrollments/attendance/OTP attempts, faculty assignments,
 * registration rows for the same email) is removed. Department HOD links are
 * cleared. Audit rows that still mention the account are removed or have
 * their actor reference nulled.
 */
export async function deleteUserCascade(
  client: PoolClient,
  userId: string,
  actorUserId: string,
): Promise<UserDeletionCounts | null> {
  const found = await client.query<{ id: string; email: string }>(
    'SELECT id, email FROM users WHERE id = $1 FOR UPDATE',
    [userId],
  );
  const target = found.rows[0];
  if (!target) {
    return null;
  }

  const started = await client.query(
    'UPDATE attendance_sessions SET started_by = $2 WHERE started_by = $1',
    [userId, actorUserId],
  );
  const closed = await client.query(
    'UPDATE attendance_sessions SET closed_by = $2 WHERE closed_by = $1',
    [userId, actorUserId],
  );
  const marked = await client.query(
    `UPDATE attendance_records
        SET marked_by = CASE WHEN method = 'manual' THEN $2::uuid ELSE NULL END
      WHERE marked_by = $1`,
    [userId, actorUserId],
  );
  const calendar = await client.query(
    'UPDATE non_working_days SET created_by = $2 WHERE created_by = $1',
    [userId, actorUserId],
  );
  const assigned = await client.query(
    'UPDATE class_faculty SET assigned_by = $2 WHERE assigned_by = $1',
    [userId, actorUserId],
  );
  const reviewed = await client.query(
    'UPDATE student_registrations SET reviewed_by = $2 WHERE reviewed_by = $1',
    [userId, actorUserId],
  );
  const hod = await client.query('UPDATE departments SET hod_user_id = NULL WHERE hod_user_id = $1', [
    userId,
  ]);

  const enrollmentIds = await selectIds(
    client,
    'SELECT id FROM enrollments WHERE student_user_id = $1',
    [userId],
  );
  const assignmentIds = await selectIds(
    client,
    'SELECT id FROM class_faculty WHERE faculty_user_id = $1',
    [userId],
  );
  const recordIds = await selectIds(
    client,
    'SELECT id FROM attendance_records WHERE student_user_id = $1',
    [userId],
  );
  const registrationIds = await selectIds(
    client,
    `SELECT id FROM student_registrations
      WHERE created_user_id = $1 OR lower(email) = lower($2)`,
    [userId, target.email],
  );

  const otpAttempts =
    (await client.query('DELETE FROM otp_attempts WHERE student_user_id = $1', [userId]))
      .rowCount ?? 0;
  await client.query('DELETE FROM attendance_records WHERE student_user_id = $1', [userId]);
  await client.query('DELETE FROM enrollments WHERE student_user_id = $1', [userId]);
  await client.query('DELETE FROM class_faculty WHERE faculty_user_id = $1', [userId]);
  if (registrationIds.length > 0) {
    await client.query('DELETE FROM student_registrations WHERE id = ANY($1::uuid[])', [
      registrationIds,
    ]);
  }

  await deleteAuditReferences(
    client,
    [userId, ...enrollmentIds, ...assignmentIds, ...recordIds, ...registrationIds],
    true,
  );
  await deleteAuditByEmail(client, target.email);
  await client.query('UPDATE audit_log SET actor_user_id = NULL WHERE actor_user_id = $1', [
    userId,
  ]);
  await client.query('DELETE FROM users WHERE id = $1', [userId]);

  return {
    enrollments: enrollmentIds.length,
    attendanceRecords: recordIds.length,
    otpAttempts,
    facultyAssignments: assignmentIds.length,
    registrations: registrationIds.length,
    reassignedSessions: (started.rowCount ?? 0) + (closed.rowCount ?? 0),
    reassignedRecords: marked.rowCount ?? 0,
    reassignedAssignments: assigned.rowCount ?? 0,
    reassignedRegistrations: reviewed.rowCount ?? 0,
    reassignedCalendarEntries: calendar.rowCount ?? 0,
    clearedHodDepartments: hod.rowCount ?? 0,
  };
}
