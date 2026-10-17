-- ============================================================================
-- 0004_non_working_days.sql
-- College calendar: administrator-managed non-working days (holidays,
-- festival days, closure days).
--
-- Design reference: docs/database-design.md (updated alongside this file).
--
-- Settled decisions reflected here:
--   * One row per calendar date (UNIQUE day); a date is either a working day
--     or not. Weekends are not assumed — only explicit entries count.
--   * `label` is the reason shown to students and faculty ("Diwali holiday").
--   * Entries are informational for the application: opening a session on a
--     non-working day is warned about in the UI but never blocked, and
--     attendance percentages are unaffected (no session = nothing settled).
--   * Removing an entry is a hard delete; removals stay visible in audit_log.
--   * The runner wraps this file in a transaction; do NOT add BEGIN/COMMIT.
--
-- Supabase hardening follows 0001: RLS on the new table and revokes for the
-- PostgREST roles.
-- ============================================================================

CREATE TABLE non_working_days (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day        date NOT NULL UNIQUE,
  label      text NOT NULL,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT non_working_days_label_not_blank CHECK (btrim(label) <> '')
);

COMMENT ON TABLE non_working_days IS
  'Administrator-managed college holidays. Informational only: sessions may still be opened on these dates (the UI warns first) and reports are unaffected because no session exists on a holiday.';

ALTER TABLE non_working_days ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON non_working_days FROM %I', role_name);
    END IF;
  END LOOP;
END
$$;
