# College Attendance Management System

[![CI](https://github.com/mageshsaran805-hue/Attandance/actions/workflows/ci.yml/badge.svg)](https://github.com/mageshsaran805-hue/Attandance/actions/workflows/ci.yml)

College Daily Morning Attendance Management System — one morning attendance
session per class per calendar day (Asia/Kolkata), with OTP-based
student self-marking, faculty corrections and department-scoped reporting.

> **Status: Phase 5 (reporting + hardening) complete — all planned phases done.**
> The database schema, migrations runner, cookie-session auth with CSRF,
> administration screens, HOD faculty assignment and the full attendance flow
> (one morning session per class per day, OTP self-marking, manual marks and
> corrections, closing that materializes absences) are in place. Phase 5 adds
> reporting — faculty per-class reports, HOD department reports, a system-wide
> admin report, per-student percentages and history — plus an admin audit-log
> view, rate limiting on failed marking attempts and a dependency-free set of
> security headers. Use **fake development data only** — never real student
> records. Post-plan additions: a GitHub Actions CI pipeline (both builds plus
> the full backend test suite against a disposable Postgres), a production
> [deployment guide](docs/deployment.md), reverse-proxy support
> (`TRUST_PROXY_HOPS`) and an admin bootstrap command (`npm run create-admin`).

## Stack

| Layer      | Technology                                          |
| ---------- | --------------------------------------------------- |
| Frontend   | React 19, TypeScript, Vite 8, Tailwind CSS 4        |
| Backend    | Node.js, Express 5, TypeScript (strict)             |
| Database   | PostgreSQL hosted on Supabase, via the `pg` driver  |
| Migrations | Numbered SQL files in `database/migrations/`        |
| Auth       | Argon2id password hashes, HS256 JWT in an HTTP-only cookie, signed double-submit CSRF |
| Tests      | Vitest + Supertest (backend)                        |

## Repository layout

```
.github/workflows/       CI: backend build + tests, frontend lint + build
frontend/                React + Vite single-page app
  src/components/        shared UI (app shell with role navigation, guards, ui/ primitives)
  src/lib/               API client, auth context, fetch/action hooks, formatting, OTP display helpers
  src/pages/             login, role dashboards and admin/, hod/, faculty/ screens (rosters and sessions)
backend/                 Express + TypeScript API
  src/config/            validated environment configuration
  src/db/                connection pool, migration runner, transactions, dev seed, admin bootstrap
  src/lib/               password hashing, tokens, CSRF, cookies, errors, OTP, timezone dates, shared schemas
  src/middleware/        auth, CSRF, validation, error handling
  src/routes/            health, auth, admin, hod, faculty, attendance, reports
  src/services/          users, departments, classes, enrollments, class-faculty, attendance, reports, audit
  src/test/              test bootstrap and helpers
database/migrations/     numbered SQL migrations (0001_core_schema.sql)
docs/                    setup.md, deployment.md, database-design.md, security.md
AGENTS.md                instructions for future coding-agent runs
```

## Quick start

Prerequisites: Arch Linux with Node.js 22+ and npm, plus a Supabase project
(hosted PostgreSQL). Full instructions: [`docs/setup.md`](docs/setup.md).

```bash
# 1. Backend
cd backend
cp .env.example .env
# paste your Supabase connection URI into DATABASE_URL, generate
# JWT_SECRET and OTP_PEPPER (commands are in the file), and pin the
# Supabase CA certificate (see docs/setup.md -> TLS)
npm install
npm run migrate           # create the schema
npm run seed:dev          # fake departments/classes/accounts for development
npm run dev               # API on http://localhost:4000

# 2. Frontend (second terminal)
cd frontend
npm install
npm run dev               # UI on http://localhost:5173 (proxies /api to the backend)
```

> After the one-time installs above, both dev servers can also be started
> together from the repository root with a single command: `npm run dev:all`.

Open <http://localhost:5173> and sign in. Seeded accounts (fake data) all use
the password `Demo@12345`; see
[`docs/setup.md`](docs/setup.md#6-development-seed-data-fake-accounts) for the
list.

## Common commands

| Where    | Command             | What it does                                  |
| -------- | ------------------- | --------------------------------------------- |
| root     | `npm run dev:all`   | Backend + frontend dev servers together       |
| backend  | `npm run dev`       | Start API with hot reload (tsx watch)         |
| backend  | `npm run build`     | Type-check and compile to `backend/dist/`     |
| backend  | `npm start`         | Run the compiled API (`node dist/index.js`)   |
| backend  | `npm run typecheck` | Type-check without emitting                   |
| backend  | `npm run migrate`   | Apply pending SQL migrations (forward-only)   |
| backend  | `npm run seed:dev`  | Insert fake development data (idempotent)     |
| backend  | `npm run create-admin` | Bootstrap/promote a real admin account (production) |
| backend  | `npm test`          | Vitest; database-backed tests need `TEST_DATABASE_URL` |
| frontend | `npm run dev`       | Vite dev server with `/api` proxy             |
| frontend | `npm run build`     | Type-check (`tsc -b`) + production build      |
| frontend | `npm run lint`      | oxlint                                        |

## API

Core:

| Endpoint            | Method | Description                                                       |
| ------------------- | ------ | ----------------------------------------------------------------- |
| `/api/health`       | GET    | Application + database health (`ok` / `down` / `not_configured`). Never exposes credentials or internal errors. |
| `/api/auth/login`   | POST   | Email + password. Sets the session cookie; rate-limited (10 failures / 15 min / IP). |
| `/api/auth/logout`  | POST   | Clears the session cookie. Requires a session.                    |
| `/api/auth/me`      | GET    | The signed-in user, or 401.                                       |

Administrator (role `admin`):

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/admin/overview` | GET | Headline counts (departments, classes, active accounts by role). |
| `/api/admin/departments` | GET, POST | List departments with HOD and usage counts; create a department. |
| `/api/admin/departments/:id` | PATCH | Rename or recode a department. |
| `/api/admin/departments/:id/hod` | PUT | Assign/clear the department HOD (strict 1:1, `hodUserId: null` clears). |
| `/api/admin/users` | GET, POST | Filter/search accounts; create admin/HOD/faculty accounts (students are faculty-created). |
| `/api/admin/users/:id` | PATCH | Update name/email. |
| `/api/admin/users/:id/status` | POST | Activate/deactivate (`isActive`); deactivation applies on the next request. |
| `/api/admin/users/:id/role` | POST | Change role; refused (409) while active role-bound records exist. |
| `/api/admin/users/:id/reset-password` | POST | Set a new password. |
| `/api/admin/classes` | GET, POST | List classes with counts; create a class in a department. |
| `/api/admin/classes/:id` | PATCH | Rename a class or change its academic year (department is immutable). |

HOD (role `hod`, own department only — out-of-scope classes answer 404):

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/hod/overview` | GET | Department summary, counts and classes with current faculty. |
| `/api/hod/faculty` | GET | Active faculty accounts eligible for assignment. |
| `/api/hod/classes/:id` | GET | Class details with active and past faculty assignments. |
| `/api/hod/classes/:id/faculty` | POST | Assign a faculty member to the class. |
| `/api/hod/assignments/:id/end` | POST | End an active assignment (history kept). |

Faculty (role `faculty`, assigned classes only — out-of-scope classes answer 404):

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/faculty/classes` | GET | Classes the account is actively assigned to. |
| `/api/faculty/classes/:id` | GET | Class details with active and former roster. |
| `/api/faculty/classes/:id/students` | POST | Create a student account and enroll it. |
| `/api/faculty/classes/:id/enroll` | POST | Enroll an existing student account by email. |
| `/api/faculty/classes/:id/students/:studentUserId` | PATCH | Update a student's name/email. |
| `/api/faculty/classes/:id/students/:studentUserId/unenroll` | POST | End the enrollment (history kept). |
| `/api/faculty/classes/:id/students/:studentUserId/reset-password` | POST | Set a new student password. |
| `/api/faculty/classes/:id/sessions` | GET, POST | Today's session plus recent history; POST opens today's session and returns its OTP (shown once). |
| `/api/faculty/sessions/:sessionId` | GET | Session with per-student status (present / absent / pending). |
| `/api/faculty/sessions/:sessionId/otp` | POST | Regenerate the OTP for an open session (old code dies; its attempt counter resets). |
| `/api/faculty/sessions/:sessionId/mark` | POST | Manual mark or correction (`studentUserId`, `status`); audit-logged. |
| `/api/faculty/sessions/:sessionId/close` | POST | Close the session: pending students become absent; marks stay correctable. |

Student (role `student`, own records only):

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/student/attendance/today` | GET | Today's session, personal record and OTP state for every actively enrolled class. |
| `/api/student/sessions/:sessionId/mark` | POST | Self-mark present with the OTP (5 attempts per code; regeneration resets; 30 failed attempts per 15 min per student). |

Reporting (all roles, scope-limited; `?from=YYYY-MM-DD&to=YYYY-MM-DD` defaults
to the last 30 days, max 366 days). Percentages count **closed sessions
only** — an open session stays pending and never drags a percentage down:

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/faculty/classes/:id/report` | GET | Class report for an assigned class: totals, per-student percentages, session list with pending counts. |
| `/api/hod/reports/attendance` | GET | Department totals with per-class percentages. |
| `/api/hod/classes/:id/report` | GET | Class detail within the HOD's department. |
| `/api/admin/reports/attendance` | GET | System-wide totals by department and by class. |
| `/api/student/attendance/history` | GET | The student's own sessions with statuses and settled percentages. |

Audit view (admin only):

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/admin/audit` | GET | Newest-first audit entries; filters `action`, `entityType`, `actorEmail`, `from`, `to`; paging `page`, `limit` (≤ 100). |
| `/api/admin/audit/actions` | GET | Distinct action names for the filter dropdown. |

All state-changing requests must echo the readable CSRF cookie
(`ca_session_csrf`) in the `X-CSRF-Token` header. Every administrative
mutation is written to the audit log with before/after snapshots (never
passwords), and accounts are deactivated rather than deleted.

## Roles and scope

- **Administrator** — departments (one HOD each), classes, and all staff
  accounts: create, edit, change role, reset password, activate/deactivate.
  Also system-wide attendance reports and the audit-log view.
- **HOD** — their own department only: view classes and rosters, assign and
  unassign faculty (full history kept), and review department attendance
  reports with per-class drill-downs.
- **Faculty** — assigned classes only: create/enroll/unenroll students, edit
  student details, reset student passwords, open/close morning sessions,
  show or regenerate the OTP, mark or correct attendance, and view the
  class's attendance report.
- **Student** — only their own record: mark themselves present with the code
  their faculty member shows, then review their own session history and
  attendance percentage.

## Security rules

- Secrets live only in git-ignored `.env` files; only `.env.example`
  placeholders are committed. `JWT_SECRET` and `OTP_PEPPER` are generated
  random values and are required for the API to start.
- `DATABASE_URL` is server-side only — never in frontend code or `VITE_*` vars.
- Passwords are hashed with Argon2id (OWASP parameters); plaintext is never
  stored or logged.
- Sessions are HS256 JWTs in `HttpOnly`, `SameSite=Lax` cookies (`Secure` in
  production). Role and active status are re-read from the database on every
  request, so deactivation takes effect immediately.
- CSRF: signed double-submit cookie + required `X-CSRF-Token` header.
- Attendance OTPs are generated server-side and stored only as
  HMAC-SHA-256 hashes (keyed with `OTP_PEPPER`); the raw code is shown once
  to the faculty member who generated it. Failed attempts are recorded
  (never the codes) and capped per code; regenerating resets the cap.
- Failed login attempts are rate-limited per IP (10 / 15 min) and failed
  self-marking attempts per student (30 / 15 min); successful requests are
  never counted, so shared campus networks are not throttled.
- Every API response carries conservative security headers
  (`nosniff`, `DENY` framing, `no-referrer`, `no-store`) and the raw OTP is
  the only secret ever returned in a response body, exactly once.
- All sensitive mutations are audit-logged with before/after snapshots and
  visible in the admin audit view; existing audit rows are never edited.
- The migration enables row-level security on every table and revokes all
  privileges from Supabase's `anon`/`authenticated` roles, so the PostgREST
  API cannot read or write student data.
- TLS certificate verification is never disabled to "make it work".
- No real student data in development, ever.

The full review (what was checked, what is accepted-by-design and what is
left for a future phase) lives in [`docs/security.md`](docs/security.md).

## Documentation

- [`docs/setup.md`](docs/setup.md) — environment setup, migrations, seeding, tests
- [`docs/deployment.md`](docs/deployment.md) — production deployment guide
- [`docs/database-design.md`](docs/database-design.md) — data model and decisions
- [`docs/security.md`](docs/security.md) — Phase 5 security review
- [`AGENTS.md`](AGENTS.md) — rules and context for coding agents
