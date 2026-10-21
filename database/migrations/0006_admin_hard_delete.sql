-- ============================================================================
-- 0006_admin_hard_delete.sql
-- Documentation-only migration for the administrator hard-delete exception.
--
-- The application normally preserves history: accounts are deactivated,
-- enrollments and faculty assignments are soft-closed, and audit rows are
-- append-only. Administrators may now permanently delete an account, class or
-- department when they need to remove test/duplicate data or free an email
-- address for reuse. The deletion services clear or reassign every RESTRICT
-- dependency inside one transaction, remove audit rows tied to the deleted
-- entity, and keep a single deletion event containing only ids and counts.
--
-- No tables are created here, so there are no new RLS/privilege changes.
-- ============================================================================

COMMENT ON COLUMN users.is_active IS
  'Accounts are normally deactivated so attendance history stays intact. An administrator may hard-delete an account instead; that frees the email and removes account-owned history.';

COMMENT ON TABLE enrollments IS
  'Enrollment history. Rows are normally soft-closed with unenrolled_at; an administrator hard-deleting a class or student removes the affected rows.';

COMMENT ON TABLE class_faculty IS
  'Faculty assignment history. Rows are normally soft-closed with unassigned_at; an administrator hard-deleting a class or account removes the affected rows.';

COMMENT ON TABLE attendance_sessions IS
  'One morning session per class per calendar date. Sessions are immutable history except that an administrator hard-deleting a class removes its sessions and records.';

COMMENT ON TABLE attendance_records IS
  'One attendance row per student per session. Rows are normally corrected, never deleted; an administrator hard-deleting a class or student removes the affected rows.';

COMMENT ON TABLE student_registrations IS
  'Public self-registration requests. Approval creates the student account and enrolls it; rejection keeps the row for history. Rows are normally never deleted, except when an administrator hard-deletes the related class or account.';

COMMENT ON COLUMN audit_log.actor_user_id IS
  'NULL for events without an authenticated actor (e.g., a failed login with an unknown email) or after the acting account is hard-deleted. Never store password hashes or plaintext OTPs here.';

COMMENT ON TABLE audit_log IS
  'Sensitive mutations with before/after snapshots. Rows are append-only during normal operation; an administrator hard-delete removes audit rows tied to the deleted entity, nulls deleted-user actor references, and keeps one deletion event with ids/counts only.';
