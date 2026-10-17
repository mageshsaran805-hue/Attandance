-- ============================================================================
-- 0003_student_section.sql
-- Optional student "section" (e.g. A, B, A1). Self-registration captures it
-- on the request and approval copies it to the student account, exactly like
-- register_number and phone; the review queue and class rosters display it.
--
-- Design reference: docs/database-design.md (updated alongside this file).
--
-- Settled decisions reflected here:
--   * The section is optional everywhere: existing accounts, staff accounts
--     and students who leave it blank stay valid with NULL.
--   * It is an informational label only — attendance remains per class.
--   * Shape limits (length, allowed characters) are enforced by the
--     application schemas; the database only forbids blank strings.
--   * The runner wraps this file in a transaction; do NOT add BEGIN/COMMIT.
-- ============================================================================

ALTER TABLE users ADD COLUMN section text;
ALTER TABLE student_registrations ADD COLUMN section text;

COMMENT ON COLUMN users.section IS
  'Optional student section/group label (e.g. A, B, A1). NULL for staff accounts and when not provided.';
COMMENT ON COLUMN student_registrations.section IS
  'Optional section the applicant provided; copied to the student account on approval.';

ALTER TABLE users ADD CONSTRAINT users_section_not_blank
  CHECK (section IS NULL OR btrim(section) <> '');
ALTER TABLE student_registrations ADD CONSTRAINT student_registrations_section_not_blank
  CHECK (section IS NULL OR btrim(section) <> '');
