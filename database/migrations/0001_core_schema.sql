-- ============================================================================
-- 0001_core_schema.sql
-- Core schema for the College Daily Morning Attendance Management System.
--
-- Design reference: docs/database-design.md (reviewed before this migration).
--
-- Settled decisions reflected here:
--   * HOD <-> department is strictly 1:1 (UNIQUE hod_user_id).
--   * A class may have more than one active faculty member, but the same
--     faculty member cannot hold two active assignments for one class.
--   * Enrollment changes are soft: unenrolled_at preserves history, and a
--     partial unique index prevents duplicate ACTIVE enrollment.
--   * Attendance states are "present"/"absent" only. Pending is the absence
--     of a record while the session is open; closing the session materializes
--     absent records for everyone still pending.
--   * The runner wraps this file in a transaction; do NOT add BEGIN/COMMIT.
--
-- Supabase hardening: this migration enables RLS on every table and revokes
-- all privileges from the PostgREST roles (anon, authenticated), so the
-- public API surface cannot read or write student data even if the anon key
-- leaks. The backend connects as the database owner, which is unaffected.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Enum types
-- ----------------------------------------------------------------------------

CREATE TYPE user_role AS ENUM ('admin', 'hod', 'faculty', 'student');
CREATE TYPE session_status AS ENUM ('open', 'closed');
CREATE TYPE attendance_status AS ENUM ('present', 'absent');
CREATE TYPE mark_method AS ENUM ('otp', 'manual');

-- ----------------------------------------------------------------------------
-- users
-- ----------------------------------------------------------------------------

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  role          user_role NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_not_blank CHECK (btrim(email) <> ''),
  CONSTRAINT users_full_name_not_blank CHECK (btrim(full_name) <> '')
);

-- Login identifiers are case-insensitive.
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

COMMENT ON COLUMN users.is_active IS
  'Accounts are deactivated instead of deleted so attendance history stays intact.';

-- ----------------------------------------------------------------------------
-- departments
-- ----------------------------------------------------------------------------

CREATE TABLE departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  code        text NOT NULL UNIQUE,
  hod_user_id uuid UNIQUE REFERENCES users (id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT departments_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT departments_code_not_blank CHECK (btrim(code) <> '')
);

COMMENT ON COLUMN departments.hod_user_id IS
  'Strict 1:1 policy: UNIQUE means a department has at most one HOD and an HOD heads at most one department. NULL until assigned.';

-- ----------------------------------------------------------------------------
-- classes
-- ----------------------------------------------------------------------------

CREATE TABLE classes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments (id) ON DELETE RESTRICT,
  name          text NOT NULL,
  academic_year text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classes_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT classes_year_not_blank CHECK (btrim(academic_year) <> ''),
  CONSTRAINT classes_identity_key UNIQUE (department_id, name, academic_year)
);

CREATE INDEX classes_department_id_idx ON classes (department_id);

-- ----------------------------------------------------------------------------
-- enrollments
-- ----------------------------------------------------------------------------

CREATE TABLE enrollments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id        uuid NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
  student_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  enrolled_at     timestamptz NOT NULL DEFAULT now(),
  unenrolled_at   timestamptz,
  CONSTRAINT enrollments_window_valid CHECK (
    unenrolled_at IS NULL OR unenrolled_at >= enrolled_at
  )
);

-- A student can be actively enrolled in a class only once. History rows
-- (unenrolled_at IS NOT NULL) may repeat, preserving past memberships.
CREATE UNIQUE INDEX enrollments_active_key
  ON enrollments (class_id, student_user_id)
  WHERE unenrolled_at IS NULL;

CREATE INDEX enrollments_class_id_idx ON enrollments (class_id);
CREATE INDEX enrollments_student_user_id_idx ON enrollments (student_user_id);

-- ----------------------------------------------------------------------------
-- class_faculty (faculty assignment history; rows are never deleted)
-- ----------------------------------------------------------------------------

CREATE TABLE class_faculty (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id        uuid NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
  faculty_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  assigned_by     uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  assigned_at     timestamptz NOT NULL DEFAULT now(),
  unassigned_at   timestamptz,
  CONSTRAINT class_faculty_window_valid CHECK (
    unassigned_at IS NULL OR unassigned_at >= assigned_at
  )
);

-- No duplicate ACTIVE assignment of one faculty member to one class.
-- Reassignment closes the old row (unassigned_at) and keeps its history.
CREATE UNIQUE INDEX class_faculty_active_key
  ON class_faculty (class_id, faculty_user_id)
  WHERE unassigned_at IS NULL;

CREATE INDEX class_faculty_class_id_idx ON class_faculty (class_id);
CREATE INDEX class_faculty_faculty_user_id_idx ON class_faculty (faculty_user_id);
CREATE INDEX class_faculty_active_faculty_idx
  ON class_faculty (faculty_user_id)
  WHERE unassigned_at IS NULL;

-- ----------------------------------------------------------------------------
-- attendance_sessions (one morning session per class per IST calendar date)
-- ----------------------------------------------------------------------------

CREATE TABLE attendance_sessions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id       uuid NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
  session_date   date NOT NULL,
  status         session_status NOT NULL DEFAULT 'open',
  otp_hash       text,
  otp_expires_at timestamptz,
  started_by     uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  closed_by      uuid REFERENCES users (id) ON DELETE RESTRICT,
  closed_at      timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_sessions_class_date_key UNIQUE (class_id, session_date),
  CONSTRAINT attendance_sessions_close_consistency CHECK (
    (status = 'open' AND closed_by IS NULL AND closed_at IS NULL)
    OR (status = 'closed' AND closed_by IS NOT NULL AND closed_at IS NOT NULL)
  )
);

-- Unique (class_id, session_date) already indexes the class_id prefix used by
-- foreign-key checks; session_date gets its own index for range reports.
CREATE INDEX attendance_sessions_session_date_idx ON attendance_sessions (session_date);

COMMENT ON CONSTRAINT attendance_sessions_class_date_key ON attendance_sessions IS
  'Database-level guarantee of one session per class per attendance date (Asia/Kolkata), even under concurrent requests.';

-- ----------------------------------------------------------------------------
-- attendance_records (one row per student per session; no row = pending)
-- ----------------------------------------------------------------------------

CREATE TABLE attendance_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      uuid NOT NULL REFERENCES attendance_sessions (id) ON DELETE RESTRICT,
  student_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status          attendance_status NOT NULL,
  method          mark_method NOT NULL,
  marked_by       uuid REFERENCES users (id) ON DELETE RESTRICT,
  marked_at       timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_records_session_student_key UNIQUE (session_id, student_user_id),
  CONSTRAINT attendance_records_method_actor CHECK (
    (method = 'otp' AND marked_by IS NULL)
    OR (method = 'manual' AND marked_by IS NOT NULL)
  )
);

-- Unique (session_id, student_user_id) indexes the session_id prefix.
CREATE INDEX attendance_records_student_user_id_idx ON attendance_records (student_user_id);

COMMENT ON COLUMN attendance_records.marked_by IS
  'NULL only for OTP self-marking. Manual marks and corrections always record the acting user; changes are also captured in audit_log.';

-- ----------------------------------------------------------------------------
-- otp_attempts (rate limiting and abuse detection for self-attendance)
-- ----------------------------------------------------------------------------

CREATE TABLE otp_attempts (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id      uuid NOT NULL REFERENCES attendance_sessions (id) ON DELETE RESTRICT,
  student_user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  success         boolean NOT NULL,
  ip              inet,
  attempted_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX otp_attempts_session_student_idx
  ON otp_attempts (session_id, student_user_id, attempted_at);
CREATE INDEX otp_attempts_student_user_id_idx ON otp_attempts (student_user_id);

COMMENT ON TABLE otp_attempts IS
  'Minimal forensic data only: no OTP values (valid or invalid) are ever stored.';

-- ----------------------------------------------------------------------------
-- audit_log (append-only history of sensitive changes)
-- ----------------------------------------------------------------------------

CREATE TABLE audit_log (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  action        text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     text NOT NULL,
  old_value     jsonb,
  new_value     jsonb,
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_entity_idx ON audit_log (entity_type, entity_id);
CREATE INDEX audit_log_created_at_idx ON audit_log (created_at);
CREATE INDEX audit_log_actor_idx ON audit_log (actor_user_id, created_at);

COMMENT ON COLUMN audit_log.actor_user_id IS
  'NULL only for events without an authenticated actor (e.g. a failed login with an unknown email). Never store password hashes or plaintext OTPs here.';
COMMENT ON TABLE audit_log IS
  'Sensitive mutations are captured here with before/after snapshots; existing rows are never updated or deleted by the application.';

-- ----------------------------------------------------------------------------
-- updated_at maintenance
-- ----------------------------------------------------------------------------

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER departments_set_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER classes_set_updated_at
  BEFORE UPDATE ON classes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER attendance_records_set_updated_at
  BEFORE UPDATE ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ----------------------------------------------------------------------------
-- Role integrity: referenced users must actually hold the required role.
--
-- This is a database-level backstop for application bugs; the API performs
-- the same checks with clear error messages. Role checks apply on INSERT and
-- on UPDATE of the referencing column, so changing a person's role later does
-- not invalidate historical rows.
-- ----------------------------------------------------------------------------

CREATE FUNCTION enforce_referenced_user_role() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected_role     user_role;
  require_active    boolean := true;
  referenced_user   uuid;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'enrollments' THEN
      expected_role := 'student';
      referenced_user := NEW.student_user_id;
    WHEN 'class_faculty' THEN
      expected_role := 'faculty';
      referenced_user := NEW.faculty_user_id;
    WHEN 'departments' THEN
      expected_role := 'hod';
      referenced_user := NEW.hod_user_id;
    WHEN 'attendance_records' THEN
      -- An inactive student may still need pending->absent materialization
      -- when a session closes, so only the role is enforced here.
      expected_role := 'student';
      require_active := false;
      referenced_user := NEW.student_user_id;
    WHEN 'otp_attempts' THEN
      expected_role := 'student';
      require_active := false;
      referenced_user := NEW.student_user_id;
    ELSE
      RAISE EXCEPTION 'enforce_referenced_user_role: unexpected table %', TG_TABLE_NAME;
  END CASE;

  -- departments.hod_user_id may be NULL until an HOD is assigned.
  IF referenced_user IS NOT NULL THEN
    IF require_active THEN
      IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = referenced_user AND role = expected_role AND is_active
      ) THEN
        RAISE EXCEPTION 'referenced user % must be an active % account', referenced_user, expected_role
          USING ERRCODE = '23514';
      END IF;
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = referenced_user AND role = expected_role
      ) THEN
        RAISE EXCEPTION 'referenced user % must have role %', referenced_user, expected_role
          USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER enrollments_user_role_check
  BEFORE INSERT OR UPDATE OF student_user_id ON enrollments
  FOR EACH ROW EXECUTE FUNCTION enforce_referenced_user_role();

CREATE TRIGGER class_faculty_user_role_check
  BEFORE INSERT OR UPDATE OF faculty_user_id ON class_faculty
  FOR EACH ROW EXECUTE FUNCTION enforce_referenced_user_role();

CREATE TRIGGER departments_hod_role_check
  BEFORE INSERT OR UPDATE OF hod_user_id ON departments
  FOR EACH ROW EXECUTE FUNCTION enforce_referenced_user_role();

CREATE TRIGGER attendance_records_user_role_check
  BEFORE INSERT OR UPDATE OF student_user_id ON attendance_records
  FOR EACH ROW EXECUTE FUNCTION enforce_referenced_user_role();

CREATE TRIGGER otp_attempts_user_role_check
  BEFORE INSERT OR UPDATE OF student_user_id ON otp_attempts
  FOR EACH ROW EXECUTE FUNCTION enforce_referenced_user_role();

-- ----------------------------------------------------------------------------
-- Supabase hardening: the API surface must not expose this schema.
--
-- 1. Enable row-level security on every table. With no policies, RLS denies
--    all access to non-owner roles; the backend connects as the owner and is
--    unaffected.
-- 2. Revoke table/sequence/function privileges from the PostgREST roles
--    (anon, authenticated) if they exist, and set matching default privileges
--    so future migrations in this schema stay locked down.
-- ----------------------------------------------------------------------------

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_faculty ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- schema_migrations is created by the migration runner before this file runs.
ALTER TABLE IF EXISTS schema_migrations ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', role_name);
    END IF;
  END LOOP;
END
$$;
