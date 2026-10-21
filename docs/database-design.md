# Database Design

The schema described here is **implemented by migrations
[`0001_core_schema.sql`](../database/migrations/0001_core_schema.sql)**
(Phase 2),
**[`0002_student_registrations.sql`](../database/migrations/0002_student_registrations.sql)**
(Phase 6, student self-registration) and
**[`0003_student_section.sql`](../database/migrations/0003_student_section.sql)**
(optional student section). This document is the design reference
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
- **Bulk promotion moves enrollments, never history** — promoting a class
  closes its active enrollment rows and creates active rows in the target
  class in one transaction. Source and target must be in the same department
  and neither may have an open attendance session; inactive accounts are
  skipped, and students already active in the target only leave the source.
  Attendance rows reference sessions, so they are never rewritten or deleted.
- **Attendance**: one session per class per IST calendar date; "pending" is
  the absence of a record while the session is open; closing materializes
  absent records for everyone still pending.
- **On duty is excused attendance** (added in 0005): an `on_duty` record is
  faculty-only (manual marks; students cannot self-mark OD). It counts as
  attendance in report percentages — `(present + on_duty) / (present +
  on_duty + absent)` — while reports still show the distinction. Closing never
  overwrites it: OD is a settled record, not pending.
- **Non-working days are informational** (added in 0004): administrators mark
  dates on the college calendar; students see them, faculty are warned before
  opening a session on one, but nothing is blocked and report math is
  unaffected (a holiday normally has no session at all).
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
| `section` | nullable (added in 0003); optional student section/group label (e.g. A, B); informational only — attendance stays per class |
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
| `section` | nullable (added in 0003); legacy column — the public registration form no longer collects a section, but existing values are kept and approval still copies them to the student account |
| `class_id` | FK → classes; the class the student chose, enrolled on approval |
| `password_hash` | Argon2id hash captured at submission; the plaintext password never reaches the database or logs |
| `status` | enum `registration_status`: `pending`, `approved`, `rejected` |
| `submitted_at` | |
| `reviewed_by`, `reviewed_at` | who reviewed it and when (NULL while pending) |
| `created_user_id` | the student account created on approval (NULL while pending/rejected) |
| check | `student_registrations_review_consistency`: reviewed rows always carry reviewer + time; approved rows always carry `created_user_id`; pending rows carry neither |
| indexes | partial unique `lower(email)` WHERE pending; partial unique `lower(register_number)` WHERE pending; (`status`, `submitted_at`); `class_id` |

### non_working_days (added in 0004)

Administrator-managed college holidays. Informational only: the app warns
(never blocks) when a session is opened on one, and reports are unaffected
because a holiday normally has no session.

| Column | Notes |
| --- | --- |
| `id` | uuid, PK |
| `day` | `date`, **UNIQUE** — one row per calendar date (IST) |
| `label` | the reason shown to students and faculty (e.g. "Diwali holiday"); must not be blank |
| `created_by` | FK → users (the administrator who added it) |
| `created_at` | |

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
| `status` | enum: `present`, `absent`, `on_duty` (OD added in 0005; OD only ever written by manual faculty marks) |
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
2. **Students without a record stay pending while the session is open** —
   pending is the absence of a row in `attendance_records` for that session.
   Nothing needs to be written at session start. `on_duty` records are settled
   attendance and therefore never counted as pending.
3. **Closing a session marks remaining pending students absent** — inside one
   transaction: insert `absent` records (method `manual`, actor = closing
   faculty) for every actively enrolled student without a record, then set
   the session `closed` with `closed_by`/`closed_at`. The unique constraint
   keeps this idempotent (existing marks — OTP, manual or OD — are untouched);
   the CHECK constraint keeps close metadata consistent.
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
9. **Promotion is transactional and soft** — the endpoint locks both class
   rows and the source enrollment rows, then inserts target enrollments and
   closes source enrollments in one transaction. A partial unique conflict
   means the student was already in the target class and is treated as such.
   Either class having an open attendance session blocks the move, because
   closing that session later would miss promoted students or mis-mark new
   ones. Session opening takes a class share lock, so it serializes with the
   promotion's class lock. Inactive accounts are reported and left in the
   source class for manual follow-up; no attendance or enrollment history is
   deleted.

## Access-control matrix (target behaviour)

| Action | ADMIN | HOD | FACULTY | STUDENT |
| --- | --- | --- | --- | --- |
| Departments CRUD | ✅ | view own | – | – |
| HOD/faculty/student accounts | ✅ | students of own dept (via class) | students of assigned classes | – |
| Classes CRUD | ✅ | view own department | view assigned | – |
| Promote students between classes | ✅ | – | – | – |
| Faculty assignment | ✅ (any) | own department | – | – |
| Open/close sessions, manual marks | – | – | assigned classes | – |
| Calendar (non-working days) | manage + view | view | view | view |
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
