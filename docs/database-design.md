# Database Design

The schema described here is **implemented by migrations
[`0001_core_schema.sql`](../database/migrations/0001_core_schema.sql)**
(Phase 2) and
**[`0002_student_registrations.sql`](../database/migrations/0002_student_registrations.sql)**
(Phase 6, student self-registration). This document is the design reference
for those migrations and for future ones; keep it in sync when the schema
changes.

Database: Supabase-hosted PostgreSQL 15+ (managed). PostgreSQL 13+ is
required (`gen_random_uuid()` is built in; no extensions needed).

## Settled decisions

- **HOD ↔ department is strictly 1:1** — `departments.hod_user_id` is UNIQUE:
  a department has at most one HOD, and an HOD leads at most one department.
- **A class may have more than one active faculty member** (co-teachers), but
  one faculty member cannot hold two active assignments for the same class.
- **Enrollment changes are soft** — `unenrolled_at` keeps the historical row;
  a partial unique index prevents duplicate *active* enrollment.
- **Attendance**: one session per class per IST calendar date; "pending" is
  the absence of a record while the session is open; closing materializes
  absent records for everyone still pending.
- **Student self-registration is request-based**: the public form only
  inserts a `student_registrations` row (password already Argon2id-hashed).
  An administrator approves it, which creates the active student account and
  enrolls it in the chosen class in one transaction; rejecting keeps the row
  for history. At most one *pending* request per email and per register
  number; rejected requests free their details for a corrected resubmission.
- **Supabase hardening** — row-level security is enabled on every table (no
  policies: deny-all for non-owner roles) and all privileges are revoked from
  the PostgREST roles `anon`/`authenticated`. The backend connects as the
  owner and is unaffected. If direct Supabase client access is ever
  introduced, separate auth and RLS policies must be designed first.

## Conventions

- **Primary keys**: `uuid` with `gen_random_uuid()` (built into PostgreSQL 13+);
  time-ordered keys are not guaranteed, which is acceptable here.
- **Timestamps**: `timestamptz`, stored in UTC. Display/data-entry uses
  `Asia/Kolkata`; the attendance date is always derived server-side.
- **Enums**: PostgreSQL enum types for role, session status, attendance
  status and marking method.
- **Email**: unique, case-insensitive via a unique index on `lower(email)`.
- **`updated_at`**: maintained by a shared `set_updated_at()` trigger function.
- **History over deletion** (`ON DELETE RESTRICT` everywhere): users are
  deactivated (`is_active`) rather than deleted; enrollment and faculty
  assignments close instead of being removed; audit rows are append-only.
- **Indexes**: every foreign key is indexed (directly or as a unique-index
  prefix); extra indexes noted per table.
- **Role integrity triggers**: `enrollments`, `class_faculty`,
  `attendance_records` and `otp_attempts` verify that referenced users hold
  the required role (and are active, where relevant) on insert/update of the
  referencing column. Changing a person's role later does not invalidate
  historical rows.

## Entity overview

```
departments 1 ── * classes 1 ── * enrollments * ── 1 users(students)
     │                │                                │
     │ hod_user_id    │ session_date                   │
     ▼                ▼                                ▼
users(hods)     attendance_sessions 1 ── * attendance_records
     ▲                │
     │        audit_log / otp_attempts
users(all roles, incl. faculty via class_faculty)
```

## Tables

### users

One row per person who can log in, any role.

| Column | Notes |
| --- | --- |
| `id` | uuid, PK |
| `email` | unique case-insensitive (`users_email_lower_key`); login identifier |
| `password_hash` | Argon2id (OWASP parameters); never plaintext |
| `full_name` | display name |
| `role` | enum: `admin`, `hod`, `faculty`, `student` |
| `is_active` | deactivation instead of deletion |
| `register_number` | nullable (added in 0002); student roll number, unique case-insensitive among non-null values (`users_register_number_key`) |
| `phone` | nullable (added in 0002); student contact number |
| `created_at`, `updated_at` | timestamptz |

### student_registrations (added in 0002)

Public self-registration requests. A row is created by the unauthenticated
form; approving it is the only way a `users` row is created from it, and the
row is never deleted (pending → approved/rejected once).

| Column | Notes |
| --- | --- |
| `id` | uuid, PK |
| `full_name`, `email`, `register_number` | submitted details; email/register number are matched case-insensitively |
| `phone` | nullable |
| `class_id` | FK → classes; the class the student chose, enrolled on approval |
| `password_hash` | Argon2id hash captured at submission; the plaintext password never reaches the database or logs |
| `status` | enum `registration_status`: `pending`, `approved`, `rejected` |
| `submitted_at` | |
| `reviewed_by`, `reviewed_at` | who reviewed it and when (NULL while pending) |
| `created_user_id` | the student account created on approval (NULL while pending/rejected) |
| check | `student_registrations_review_consistency`: reviewed rows always carry reviewer + time; approved rows always carry `created_user_id`; pending rows carry neither |
| indexes | partial unique `lower(email)` WHERE pending; partial unique `lower(register_number)` WHERE pending; (`status`, `submitted_at`); `class_id` |

### departments

| Column | Notes |
| --- | --- |
| `id` | uuid, PK |
| `name`, `code` | both unique |
| `hod_user_id` | FK → users, **UNIQUE** (strict 1:1); NULL until assigned |
| `created_at`, `updated_at` | |

### classes

The attendance unit (e.g. "3rd Year — Section A").

| Column | Notes |
| --- | --- |
| `id` | uuid, PK |
| `department_id` | FK → departments, indexed |
| `name` | e.g. "3rd Year — Section A" |
| `academic_year` | e.g. `2026-27` |
| `created_at`, `updated_at` | |
| constraint | **unique (`department_id`, `name`, `academic_year`)** |

### enrollments

| Column | Notes |
| --- | --- |
| `id` | uuid, PK |
| `class_id` | FK → classes, indexed |
| `student_user_id` | FK → users (role `student`, enforced by trigger), indexed |
| `enrolled_at` | when membership began |
| `unenrolled_at` | NULL while active; set when membership ends |
| constraint | **partial unique (`class_id`, `student_user_id`) WHERE `unenrolled_at IS NULL`** — one *active* enrollment per student per class; history rows may repeat |

### class_faculty (faculty assignment history)

HODs assign/reassign faculty to classes. Records are never deleted; a
reassignment closes the previous row so the full history stays auditable.

| Column | Notes |
| --- | --- |
| `id` | uuid, PK |
| `class_id` | FK → classes, indexed |
| `faculty_user_id` | FK → users (role `faculty`, enforced by trigger), indexed |
| `assigned_by` | FK → users (the acting HOD) |
| `assigned_at` | when the assignment began |
| `unassigned_at` | NULL while active |
| constraint | **partial unique (`class_id`, `faculty_user_id`) WHERE `unassigned_at IS NULL`** — no duplicate active assignment; history may repeat |

### attendance_sessions

One morning session per class per IST calendar day.

| Column | Notes |
| --- | --- |
| `id` | uuid, PK |
| `class_id` | FK → classes (unique-index prefix) |
| `session_date` | `date`, the **Asia/Kolkata** calendar date; indexed for ranges |
| `status` | enum: `open`, `closed` |
| `otp_hash` | HMAC-SHA-256 with `OTP_PEPPER` — never the raw OTP |
| `otp_expires_at` | set when an OTP is generated |
| `started_by` | FK → users (faculty who opened it) |
| `closed_by`, `closed_at` | set together on close (CHECK-constrained) |
| `created_at` | also serves as the opening time |
| constraint | **unique (`class_id`, `session_date`)** — duplicate sessions are impossible at the database level, even under concurrency |

### attendance_records

One row per student per session, created by OTP self-marking or manual
faculty action. **No row = pending** while the session is open.

| Column | Notes |
| --- | --- |
| `id` | uuid, PK |
| `session_id` | FK → attendance_sessions (unique-index prefix) |
| `student_user_id` | FK → users (role `student`, enforced by trigger), indexed |
| `status` | enum: `present`, `absent` |
| `method` | enum: `otp` (self), `manual` (faculty/correction) |
| `marked_by` | FK → users; **NULL for OTP self-marking**, set for manual marks |
| `marked_at`, `updated_at` | |
| constraint | **unique (`session_id`, `student_user_id`)** |
| check | `manual` requires `marked_by`; `otp` requires `marked_by IS NULL` |

### otp_attempts

Rate limiting / lockout support and forensic review. Only minimal data is
stored: **no OTP values (valid or invalid) are ever written**.

| Column | Notes |
| --- | --- |
| `id` | bigint identity, PK |
| `session_id` | FK → attendance_sessions |
| `student_user_id` | FK → users (role `student`), indexed |
| `success` | boolean |
| `ip` | `inet`, nullable |
| `attempted_at` | timestamptz |
| index | (`session_id`, `student_user_id`, `attempted_at`) |

### audit_log

Append-only history for sensitive mutations (manual marks, corrections,
session start/close, faculty assignment, account/permission changes, login
events).

| Column | Notes |
| --- | --- |
| `id` | bigint identity, PK |
| `actor_user_id` | FK → users; **NULL only for events without an authenticated actor** (e.g. failed login with unknown email) |
| `action` | text, e.g. `auth.login`, `session.close`, `class.faculty_assign` |
| `entity_type`, `entity_id` | what was changed (`entity_id` is text for flexibility) |
| `old_value`, `new_value` | `jsonb` snapshots; **never** hashes, tokens or plaintext OTPs |
| `ip` | `inet`, nullable |
| `created_at` | |
| indexes | (`entity_type`, `entity_id`), (`created_at`), (`actor_user_id`, `created_at`) |

### schema_migrations

Created and maintained by the migration runner: `filename` (PK), `checksum`
(SHA-256 of the file), `applied_at`. Also RLS-locked and privilege-revoked.

## How the business rules map to the schema

1. **One morning session per class per date (Asia/Kolkata)** — the backend
   derives the date in `APP_TIMEZONE`; the unique constraint on
   (`class_id`, `session_date`) makes a second session impossible at the
   database level, even under concurrent requests.
2. **Students without a present record stay pending while the session is
   open** — pending is the absence of a row in `attendance_records` for that
   session. Nothing needs to be written at session start.
3. **Closing a session marks remaining pending students absent** — inside one
   transaction: insert `absent` records (method `manual`, actor = closing
   faculty) for every actively enrolled student without a record, then set
   the session `closed` with `closed_by`/`closed_at`. The unique constraint
   keeps this idempotent; the CHECK constraint keeps close metadata
   consistent.
4. **One attendance record per student per session** — unique
   (`session_id`, `student_user_id`). OTP self-marking uses
   `INSERT ... ON CONFLICT DO NOTHING` so a student cannot mark twice.
5. **HOD access is restricted to their department** — every query joins
   `classes.department_id` against the HOD's department (via
   `departments.hod_user_id`); the backend enforces this and never trusts
   role claims alone.
6. **Faculty access is restricted to assigned classes** — queries join
   `class_faculty` where `faculty_user_id = <current user>` AND
   `unassigned_at IS NULL`.
7. **Students can access only their own attendance history** — student
   queries are always filtered by `student_user_id = <current user id>`.
8. **Approval is the only path from a registration to an account** — the
   admin approve endpoint locks the pending row (`FOR UPDATE`), creates the
   account and enrollment, and marks the registration approved in one
   transaction with an audit row; concurrent reviews settle exactly once.

## Access-control matrix (target behaviour)

| Action | ADMIN | HOD | FACULTY | STUDENT |
| --- | --- | --- | --- | --- |
| Departments CRUD | ✅ | view own | – | – |
| HOD/faculty/student accounts | ✅ | students of own dept (via class) | students of assigned classes | – |
| Classes CRUD | ✅ | view own department | view assigned | – |
| Faculty assignment | ✅ (any) | own department | – | – |
| Open/close sessions, manual marks | – | – | assigned classes | – |
| Enter OTP for self | – | – | – | own class, once/day |
| Reports | system-wide | own department | assigned classes | own history only |
| Submit self-registration | – (anyone, no account needed) | – | – | – |
| Review registrations (approve/reject) | ✅ | – | – | – |

## Migrations

- One numbered SQL file per change, forward-only:
  `database/migrations/000X_name.sql` (see that directory's README for
  conventions and runner behaviour).
- Applied in order, tracked in `schema_migrations` with checksums; each file
  runs inside a transaction together with its bookkeeping row.
- Destructive statements require explicit review.
