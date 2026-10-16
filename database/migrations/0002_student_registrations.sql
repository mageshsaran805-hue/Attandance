-- ============================================================================
-- 0002_student_registrations.sql
-- Student self-registration: public registration requests that an
-- administrator reviews (approve / reject) before any account is created.
--
-- Design reference: docs/database-design.md (reviewed before this migration).
--
-- Settled decisions reflected here:
--   * Register number and phone are optional profile fields on `users` so
--     accounts created before this feature (and staff accounts) stay valid;
--     the public registration form requires a register number.
--   * A registration is a self-contained request: the password is hashed at
--     submission time, and approving it is the only way a `users` row is
--     created from it. Approving also enrolls the student in the class they
--     chose. Rejected rows are kept for history.
--   * At most one PENDING request per email and per register number;
--     rejected requests free their email/register number for a corrected
--     resubmission. Once approved, the case-insensitive uniqueness of
--     `users` prevents duplicates.
--   * The runner wraps this file in a transaction; do NOT add BEGIN/COMMIT.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- users: student profile fields
-- ----------------------------------------------------------------------------

ALTER TABLE users ADD COLUMN register_number text;
ALTER TABLE users ADD COLUMN phone text;

COMMENT ON COLUMN users.register_number IS
  'Student roll/register number. NULL for staff accounts and for students added before this field existed.';

ALTER TABLE users ADD CONSTRAINT users_register_number_not_blank
  CHECK (register_number IS NULL OR btrim(register_number) <> '');
ALTER TABLE users ADD CONSTRAINT users_phone_not_blank
  CHECK (phone IS NULL OR btrim(phone) <> '');

-- Case-insensitive uniqueness among the accounts that carry one.
CREATE UNIQUE INDEX users_register_number_key
  ON users (lower(register_number))
  WHERE register_number IS NOT NULL;

-- ----------------------------------------------------------------------------
-- registration_status
-- ----------------------------------------------------------------------------

CREATE TYPE registration_status AS ENUM ('pending', 'approved', 'rejected');

-- ----------------------------------------------------------------------------
-- student_registrations
-- ----------------------------------------------------------------------------

CREATE TABLE student_registrations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name       text NOT NULL,
  email           text NOT NULL,
  register_number text NOT NULL,
  phone           text,
  class_id        uuid NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
  password_hash   text NOT NULL,
  status          registration_status NOT NULL DEFAULT 'pending',
  submitted_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_by     uuid REFERENCES users (id) ON DELETE RESTRICT,
  reviewed_at     timestamptz,
  created_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  CONSTRAINT student_registrations_full_name_not_blank CHECK (btrim(full_name) <> ''),
  CONSTRAINT student_registrations_email_not_blank CHECK (btrim(email) <> ''),
  CONSTRAINT student_registrations_register_number_not_blank CHECK (btrim(register_number) <> ''),
  CONSTRAINT student_registrations_phone_not_blank CHECK (phone IS NULL OR btrim(phone) <> ''),
  CONSTRAINT student_registrations_review_consistency CHECK (
    (status = 'pending'  AND reviewed_by IS NULL     AND reviewed_at IS NULL AND created_user_id IS NULL)
    OR (status = 'approved' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND created_user_id IS NOT NULL)
    OR (status = 'rejected' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND created_user_id IS NULL)
  )
);

COMMENT ON TABLE student_registrations IS
  'Public self-registration requests. Approval creates the student account and enrolls it; rejection keeps the row for history. The application never deletes rows.';
COMMENT ON COLUMN student_registrations.password_hash IS
  'Argon2id hash captured at submission time; the plaintext password is never stored or logged.';

-- One PENDING request per email and per register number; reviewed rows are
-- history and do not block a corrected resubmission.
CREATE UNIQUE INDEX student_registrations_pending_email_key
  ON student_registrations (lower(email))
  WHERE status = 'pending';
CREATE UNIQUE INDEX student_registrations_pending_register_number_key
  ON student_registrations (lower(register_number))
  WHERE status = 'pending';

-- Serves the review queue (pending, oldest first) and the history filters.
CREATE INDEX student_registrations_status_submitted_idx
  ON student_registrations (status, submitted_at);
CREATE INDEX student_registrations_class_id_idx ON student_registrations (class_id);

-- ----------------------------------------------------------------------------
-- Supabase hardening (same policy as 0001): RLS on, PostgREST roles revoked.
-- ----------------------------------------------------------------------------

ALTER TABLE student_registrations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE student_registrations FROM %I', role_name);
    END IF;
  END LOOP;
END
$$;
