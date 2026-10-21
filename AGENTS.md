# AGENTS.md — instructions for coding agents

This file tells future coding-agent runs how to work in this repository.
Follow it together with the user's explicit instructions for the current task.

## Project

College Daily Morning Attendance Management System: one morning attendance
session per class per calendar day (Asia/Kolkata), OTP-based student
self-marking, manual faculty corrections, department-scoped HOD reporting,
admin-managed accounts.

## Stack

- Frontend: React 19 + TypeScript + Vite 8 + Tailwind CSS 4 + React Router 8 (`frontend/`)
- Backend: Node.js + Express 5 + TypeScript strict (`backend/`)
- Database: Supabase-hosted PostgreSQL, accessed with `pg` (no ORM)
- Migrations: numbered SQL files in `database/migrations/` (runner: `backend/src/db/migrate.ts`)
- Auth: Argon2id (`@node-rs/argon2`), HS256 JWT in an HttpOnly cookie (`jose`), signed double-submit CSRF
- Tests: Vitest + Supertest (`backend/src/**/*.test.ts`)
- Package manager: npm; separate npm projects for `frontend/` and `backend/`

## Commands

| Where    | Command             | Purpose                          |
| -------- | ------------------- | -------------------------------- |
| root     | `npm run dev:all`   | Backend + frontend dev servers together (port 4000 + 5173) |
| backend  | `npm run dev`       | API with hot reload (port 4000)  |
| backend  | `npm run build`     | Type-check + compile to `dist/`  |
| backend  | `npm run typecheck` | Type-check only                  |
| backend  | `npm run migrate`   | Apply pending SQL migrations     |
| backend  | `npm run seed:dev`  | Insert fake development data     |
| backend  | `npm run create-admin` | Bootstrap/promote a real admin account (production; reads `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`) |
| backend  | `npm test`          | Vitest (needs `TEST_DATABASE_URL` for DB-backed tests) |
| frontend | `npm run dev`       | Vite dev server (port 5173)      |
| frontend | `npm run lint`      | oxlint                           |
| frontend | `npm run build`     | `tsc -b` + production build      |

Verification for a typical change: backend `npm run build`, frontend
`npm run lint && npm run build`, and a live `curl http://localhost:4000/api/health`
when backend behaviour changed. Report only results that were actually observed.

## Golden rules

1. **Implement only the requested phase.** Do not add later-phase features
   (attendance logic, OTP flows, dashboards) ahead of schedule.
2. **Inspect before changing.** Read the relevant files and `git status` first;
   never overwrite existing work without checking what it is.
3. **Preserve working code.** Prefer small targeted edits over rewrites.
   Do not delete files (or run destructive commands like `git reset`,
   DB drops, or `--overwrite` scaffolds) without explicit approval.
4. **Secrets stay server-side.** `.env` files are git-ignored; only
   `.env.example` files with placeholders are committed. `DATABASE_URL`,
   passwords and keys must never appear in frontend code or `VITE_*` vars.
5. **Never disable TLS verification** (no `rejectUnauthorized: false`,
   no `sslmode=no-verify`) to work around connection problems.
6. **Fake data only** in development — never real student information.
7. **Database changes only via migrations** in `database/migrations/`,
   reviewed in `docs/database-design.md`. Do not create ad-hoc tables.
8. **No invented configuration.** If a credential or secret is missing,
   explain exactly what the user must provide; never guess or fabricate it.
9. **Report honestly.** State exactly which checks ran and what they printed.
   If a check could not run, say so and why.
10. **Keep dependencies minimal.** Justify anything new; avoid heavy deps/ORMs.

## Environment notes

- Timezone for attendance dates is `APP_TIMEZONE` (default `Asia/Kolkata`).
- `JWT_SECRET` and `OTP_PEPPER` are required; the process refuses to start
  without them. Generate with
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
- With `DATABASE_URL` unset, the API still starts; `/api/health` reports the
  database as `"not_configured"` and database-backed endpoints return 503.
- Tests never touch the development database: `src/test/setup.ts` forces
  `DATABASE_URL` to `TEST_DATABASE_URL` (or blank). DB-backed tests are
  skipped unless `TEST_DATABASE_URL` is set.
- Login semantics: sessions are stateless JWTs; deactivation/role changes
  take effect on the next request; logout clears the cookie client-side.
- Account creation semantics: emails stay unique for all accounts. Creating
  an admin/HOD/faculty account with the email of a deactivated account
  reactivates and updates that account (same id/history) instead of inserting
  a duplicate; active duplicates are rejected. Role changes during reuse obey
  the same active-record guards as the role endpoint.
- Admin hard-delete semantics: `DELETE /api/admin/users/:id`,
  `/api/admin/classes/:id` and `/api/admin/departments/:id` are the explicit
  exception to the history-preserving rules. Each runs a transactional
  cascade: deleting a class removes its sessions, attendance records, OTP
  attempts, enrollments, faculty assignments and registration requests;
  deleting a department does the same for every class inside it; deleting an
  account removes its enrollments, attendance/OTP rows, faculty assignments
  and registration links, clears any HOD link, reassigns preserved actor
  references (sessions started, manual marks, calendar entries, assignments
  made, reviews performed) to the deleting admin, and frees the email. Audit
  rows tied to the deleted entity are removed, deleted-user actor references
  are nulled, and one deletion event with ids/counts only is retained. The UI
  requires typing `DELETE`. Never use this path for routine cleanup.
- The migration enables RLS and revokes `anon`/`authenticated` grants —
  keep doing that in every future migration that creates tables.
- The Vite dev proxy forwards `/api/*` from :5173 to :4000
  (`frontend/vite.config.ts`).
- Attendance semantics: one session per class per calendar day; "pending"
  means no `attendance_records` row while the session is open; closing inserts
  absent records for everyone still pending; students can self-mark only on
  the session's calendar date. OTP: 6 digits, 10-minute expiry, 5 attempts
  per OTP generation (regenerating the OTP resets the counter and invalidates
  the old code); `otp_attempts` records never contain code values. On-duty
  (`on_duty`) records are faculty-only manual marks (excused attendance): they
  count as present in percentages, closing never overwrites them, and bulk
  mark-all stays present/absent only.
- Calendar semantics: admins manage `non_working_days` (date + label,
  audit-logged; `/api/calendar/non-working-days` read for every signed-in
  role); faculty get a confirm dialog before opening a session on a
  non-working day and students see a month grid. Holidays never block
  sessions and never change report math.
- Reporting semantics: percentages count closed sessions only (open sessions
  are listed as pending and excluded); percentage = (present + on_duty) /
  (present + on_duty + absent), rounded to one decimal, null when nothing is
  settled. Ranges are `?from=YYYY-MM-DD&to=YYYY-MM-DD` (college timezone;
  default last 30 days, max 366). The admin audit view is read-only and
  paginated.
- Rate limits (in-memory, per process): login 10 failures / 15 min / IP;
  student self-marking 30 failures / 15 min / student; registration
  submissions 30 requests / 15 min / IP. Successful requests
  are never counted (except registrations, where every submission counts).
- `TRUST_PROXY_HOPS` (default 0) sets Express `trust proxy`; use 1 behind a
  single reverse proxy so rate limits key on real client IPs, keep 0 when the
  API is directly reachable. `npm run create-admin` bootstraps/promotes a real
  admin account (env: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME`).
  Production steps: `docs/deployment.md` (free-tier variant:
  `docs/deployment-free.md`, Netlify + Render); CI: `.github/workflows/ci.yml`.
- API responses set security headers (`nosniff`, `DENY`, `no-referrer`,
  CORP same-origin, `Cache-Control: no-store`) in `src/app.ts`.
- Access control model (design): ADMIN manages departments/accounts; HOD sees
  only their department; FACULTY only assigned classes; STUDENT only own record.

## Phase plan

- **Phase 1 — foundation (done):** scaffolding, health endpoint, docs, env setup.
- **Phase 2 — schema + auth (done):** `0001_core_schema.sql`, migration runner
  with checksums, Argon2id, login/logout/me with HttpOnly cookie sessions,
  CSRF, role middleware, audit logging, dev seed, login UI + role-guarded
  placeholder dashboards.
- **Phase 3 — administration (done):** departments, HOD accounts,
  classes, enrollments, faculty assignment; admin/HOD/faculty management
  screens; audit-logged mutations; integration tests for scoping and guards.
- **Phase 4 — attendance (done):** one morning session per class per day
  (Asia/Kolkata), OTP generation/regeneration (6 digits, 10 min, 5 attempts per
  code, HMAC-hashed at rest), student self-marking, faculty manual
  marking/corrections, closing that materializes pending students as absent;
  audit-logged mutations; API smoke + integration tests.
- **Phase 5 — reporting + hardening (done):** faculty/HOD/admin/student
  reports with attendance percentages (closed sessions only), admin audit
  view with filters and paging, per-student rate limiting on failed
  self-marking attempts, dependency-free security headers, and the security
  review in `docs/security.md`.
- **Phase 6 — student self-registration (done):** public `/register` form
  (name, email, register number, phone, department + class, password) that
  creates a pending `student_registrations` request; admin-only review queue
  (`/admin/registrations`) with single and bulk approve/reject — approval
  creates the active student account with the submitted password and
  auto-enrolls it in the chosen class, all audit-logged; register number and
  phone live on `users` and are editable from the faculty roster.
- **Post-plan (done):** housekeeping (removed an unused component), GitHub
  Actions CI (`.github/workflows/ci.yml`: backend build + full tests against
  a disposable Postgres, frontend lint + build), production
  `docs/deployment.md`, `TRUST_PROXY_HOPS` reverse-proxy support, and the
  `create-admin` bootstrap command.
- **Post-plan — calendar + on-duty + PWA (done):** admin-managed
  `non_working_days` (migration 0004) with a read API for all roles, an admin
  Calendar page, a faculty warning/confirm when opening a session on a
  holiday, and a student month calendar; `on_duty` attendance status
  (migration 0005) with faculty-only marking, excused percentage math and
  report columns; web-app manifest + icons (no service worker, by design) so
  the site can be added to phone home screens.
- **Post-plan — year-end promotion (done):** admin-only bulk move of active
  students from one class to another class in the same department, exposed on
  the Classes page. Source enrollments are soft-closed, target enrollments are
  created, inactive accounts are skipped and reported, either class having an
  open session blocks the move, and the whole operation is audit-logged. No
  schema change; attendance history is untouched.
- **Post-plan — admin hard delete (done):** admin-only permanent deletion of
  accounts, classes and departments, exposed on the Accounts, Classes and
  Departments pages with type-`DELETE` confirmation. Transactional cascades
  remove dependent rows, free account emails, clear/reassign references, and
  clean up entity-related audit rows while retaining one ids/counts-only
  deletion event. Migration `0006_admin_hard_delete.sql` updates the affected
  schema comments only.
