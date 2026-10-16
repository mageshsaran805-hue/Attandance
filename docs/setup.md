# Setup Guide

Everything needed to run the College Attendance Management System locally on
Arch Linux, with PostgreSQL hosted on Supabase.

> Phase 1 note: no local PostgreSQL server is used. The database is hosted on
> Supabase. Do not install or initialize a local PostgreSQL server for this
> project.

## 1. Prerequisites

### Node.js and npm (Arch Linux)

```bash
sudo pacman -S --needed nodejs npm
node --version   # expect v22 or newer (developed on v26)
npm --version    # expect npm 10+
```

### Supabase project

1. Create an account at <https://supabase.com> and create a project
   (a free tier project is enough for development). Choose a region close to
   you (e.g. `ap-south-1` for India) and set a strong database password when
   asked.
2. The attendance schema is created from this repository: after configuring
   the connection string (below), run `npm run migrate` in `backend/` once.

## 2. Find your database connection details

In the Supabase dashboard:

**Project Settings → Database → Connection string → URI**

(or use the **Connect** button at the top of the project).

You will see several connection options. They differ like this:

| Option             | Host / port                                        | When to use it                                                                 |
| ------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Direct connection** | `db.<project-ref>.supabase.co:5432`               | Simplest, but **IPv6-only** by default. Works if your network/ISP supports IPv6. |
| **Session pooler**  | `aws-0-<region>.pooler.supabase.com:5432` (user `postgres.<project-ref>`) | **Recommended here.** IPv4-compatible and suited to a long-lived Node server that keeps a small connection pool. Should be your default choice. |
| **Transaction pooler** | `aws-0-<region>.pooler.supabase.com:6543`      | Designed for serverless functions making short-lived connections; not needed for this Express backend. |

This backend keeps a small, long-lived pool (`max: 5`), so use the **session
pooler** unless your network supports IPv6 and you prefer the direct connection.

Replace `[YOUR-PASSWORD]` in the URI with the database password from step 1.

### TLS

Supabase serves its database certificate from a **Supabase-managed CA** that
public trust stores do not know. Connecting with strict verification therefore
fails with `self-signed certificate in certificate chain` until you pin the CA:

1. Supabase Dashboard → **Project Settings → Database → SSL Configuration** →
   download the certificate (e.g. `prod-ca-2021.crt`).
2. Save it as `backend/certs/supabase-ca.crt` (create the folder if needed).
3. Use `sslmode=verify-full&sslrootcert=certs/supabase-ca.crt` in the
   connection string — full chain **and** hostname verification.

Do **not** disable TLS verification (`rejectUnauthorized: false`,
`sslmode=no-verify`, `uselibpqcompat=true`) to work around connection
problems — fix the certificate instead (see Troubleshooting).

## 3. Configure the backend

```bash
cd backend
cp .env.example .env
npm install
```

`.env` is git-ignored and must never be committed. `.env.example` contains
placeholders only. Fill in:

1. **`DATABASE_URL`** — your Supabase connection string (section 2 above).
   Optional to boot the API: without it, the server still starts and
   `/api/health` reports `not_configured`.
2. **`JWT_SECRET`** and **`OTP_PEPPER`** — required; the API refuses to start
   without them. Generate each one separately:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
# or: openssl rand -base64 48
```

Copy each output into `.env`. Never reuse these values and never commit them.
`JWT_SECRET` signs session and CSRF tokens; `OTP_PEPPER` keys attendance OTP
hashing (used from the attendance phase).

## 4. Create the schema and seed development data

With `DATABASE_URL` configured:

```bash
cd backend
npm run migrate     # applies database/migrations/*.sql in order (safe to re-run)
npm run seed:dev    # inserts fake departments, classes and accounts (idempotent)
```

The migration runner records applied files in `schema_migrations`, verifies
checksums (editing an applied migration is refused), and wraps each migration
in a transaction. `seed:dev` refuses to run when `NODE_ENV=production`.

## 5. Run the application

Install the frontend dependencies once (the backend ones were installed in
section 3):

```bash
cd frontend && npm install && cd ..
```

Then start both dev servers with one command from the repository root:

```bash
npm run dev:all
# [server] API listening on http://localhost:4000
# Vite at http://localhost:5173, proxying /api -> http://localhost:4000
```

Prefer separate terminals? Run `npm run dev` inside `backend/` and `frontend/`
respectively — same result. Both dev servers stop together with Ctrl+C.

Open <http://localhost:5173>, sign in with a seeded account (see below), and
check the status card on the sign-in page:

- **API server: Online** — the backend answered.
- **Database: Connected (N ms)** — `SELECT 1` succeeded on Supabase.
- **Database: Not configured** — `DATABASE_URL` is empty in `backend/.env`.
- **Database: Configured but unreachable** — the credentials/host are wrong,
  TLS failed, or the network blocked the connection. Check the backend logs
  for the server-side error, then the Troubleshooting section.

You can also hit the API directly:

```bash
curl http://localhost:4000/api/health
```

## 6. Development seed data (fake accounts)

All seeded accounts use the password `Demo@12345`. This is **fake data for
development and demonstrations only** — never real students.

| Email | Role | Name |
| --- | --- | --- |
| `admin@college.test` | admin | Meera Krishnan |
| `hod.cse@college.test` | hod | Dr. Anita Sharma (CSE) |
| `hod.ece@college.test` | hod | Dr. Rajesh Kumar (ECE) |
| `priya.menon@college.test` | faculty | Priya Menon (assigned: CSE 3rd Year A) |
| `arjun.rao@college.test` | faculty | Arjun Rao (assigned: CSE 3rd Year B) |
| `sunita.patel@college.test` | faculty | Sunita Patel (assigned: ECE 2nd Year A) |
| `vikram.iyer@college.test` | faculty | Vikram Iyer (unassigned, for assignment demos) |
| `aarti.nair@college.test` … | student | 16 students across the three classes |

### Try the administration flows

1. Sign in as `admin@college.test` — **Departments** (create one, assign an
   HOD), **Classes** (create a class in a department), **Accounts** (create
   an HOD or faculty account, change a role, deactivate/reactivate).
2. Sign in as `hod.cse@college.test` — open a class and assign or remove
   faculty; the assignment history is kept.
3. Sign in as `priya.menon@college.test` — open an assigned class and manage
   its roster: add a student, enroll an existing one, edit details, reset a
   password, unenroll (history is preserved).

### Try the attendance flow

Morning attendance is one session per class per day (Asia/Kolkata):

1. Sign in as `priya.menon@college.test`, open an assigned class and use
   **Open today's session**: a 6-digit OTP is generated and shown (it is valid
   for 10 minutes; the server stores only its hash, so it is displayed again
   only in the browser that generated it — use **Regenerate OTP** otherwise).
   The session view lists every student as pending.
2. In another browser (or private window) sign in as `aarti.nair@college.test`
   — the student page shows today's session and an OTP field. Enter the code:
   the student is marked present immediately. Wrong codes are counted (5 per
   code; regenerating resets the counter) and expired codes are refused.
3. Back as faculty, use **Mark present / Mark absent** for students who did
   not self-mark (forgot their phone, left the room, …). Every manual change
   is audit-logged with before/after.
4. **Close session**: everyone still pending becomes absent. Students can no
   longer self-mark, but faculty corrections remain possible on the session
   view (e.g. a late arrival), also audit-logged.

### Try the reporting and audit views

Percentages count **closed sessions only**; a session that is still open
stays pending and is excluded from percentages until it is closed.

1. As `priya.menon@college.test`, open an assigned class and use
   **Attendance report** (top right): totals, each student's percentage and
   the session list for the date range (defaults to the last 30 days).
2. As `hod.cse@college.test`, open **Reports**: department totals plus a row
   per class; **Class report →** drills into one class.
3. As `admin@college.test`, open **Reports** for the system-wide view by
   department and class, and **Audit log** to browse every sensitive change
   with actor, before/after snapshots, filters (action, actor email, date
   range) and paging.
4. As `aarti.nair@college.test`, the bottom of **My attendance** shows the
   student's own history and settled percentage for the chosen range.

## 7. Checks

```bash
cd backend && npm run build        # TypeScript compile
cd backend && npm test             # unit tests (DB-backed tests need TEST_DATABASE_URL)
cd backend && npm audit            # dependency scan (expect 0 vulnerabilities)
cd frontend && npm run lint        # oxlint
cd frontend && npm run build       # tsc -b + production build
cd frontend && npm audit           # dependency scan (expect 0 vulnerabilities)
git check-ignore backend/.env      # should print the path (i.e. it IS ignored)
git check-ignore backend/.env.example; echo $?  # should print 1 (NOT ignored)
```

### Database-backed tests (optional)

Create a separate disposable database (another free Supabase project is
cleanest), set `TEST_DATABASE_URL` in `backend/.env`, and `npm test` will
apply migrations there and run the auth, administration, attendance and
reporting integration tests. Tests **never** touch your development database: the test bootstrap
forces the connection to `TEST_DATABASE_URL` and skips those tests when it
is unset. Every integration test cleans up the rows it creates.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| `database: down`, log says `getaddrinfo ENOTFOUND ...` | Wrong host in `DATABASE_URL`; re-copy the URI from the Supabase dashboard. |
| `database: down`, log says `connect ETIMEDOUT` / hangs | Direct connection used on an IPv4-only network. Switch to the **session pooler** URI. |
| `database: down`, log mentions `self-signed certificate in certificate chain` | Expected until Supabase's CA is pinned: download the certificate from Dashboard → Project Settings → Database → SSL Configuration, save it as `backend/certs/supabase-ca.crt`, and keep `sslmode=verify-full&sslrootcert=certs/supabase-ca.crt` in `DATABASE_URL`. A corporate proxy/VPN can also cause this; never disable certificate verification to bypass it. |
| `database: down`, log mentions other `unable to verify` or certificate errors | TLS interception (VPN, corporate proxy) or a modified config. Fix the network/config; never disable certificate verification. |
| `database: down`, log says `password authentication failed` | `[YOUR-PASSWORD]` was not replaced, or the password is wrong. Reset it in Supabase (Settings → Database → Reset database password) and update `.env`. |
| `[config] Invalid environment configuration ... JWT_SECRET / OTP_PEPPER` | The secrets are missing or shorter than 32 characters. Generate them as in section 3 and restart. |
| `npm run migrate` prints `DATABASE_URL is not set` | Fill `DATABASE_URL` in `backend/.env` first (section 3). |
| `npm run migrate` refuses: migration was modified after it was applied | Never edit an applied migration; add a new numbered file instead. |
| API returns `503 Database is not configured on this server` | `DATABASE_URL` is empty; login and all database endpoints need it. |
| API returns `429 Too many login attempts` | Login throttling (10 failures / 15 min / IP). Wait, or restart the backend to clear the in-memory counter. |
| Student gets `409 The OTP has expired` or `429 Too many incorrect attempts` | The 6-digit code is valid for 10 minutes and allows 5 attempts. Faculty must regenerate the OTP (the old code stops working and the attempt counter resets). |
| Student gets `429 Too many attendance marking attempts` | Failed self-marking attempts are limited per student (30 / 15 min) in addition to the per-code 5-attempt cap. Wait a few minutes, or restart the backend to clear the in-memory counter. |
| Report totals look "too low" right after a morning session | Percentages count closed sessions only. Close the session and reload the report. |
| API returns `403 Invalid or missing CSRF token` | When calling the API manually, first GET any `/api` endpoint with a cookie jar, then send the `ca_session_csrf` cookie value as `X-CSRF-Token`. Browsers handle this automatically through the frontend. |
| Frontend shows "API server: Unreachable" | Backend is not running or not on port 4000. Start it with `npm run dev` in `backend/`. |
| Port already in use | Change `PORT` in `backend/.env`, and update the proxy target in `frontend/vite.config.ts` to match. |

## Security reminders

- Never commit `.env`; only `.env.example` placeholders belong in Git.
- `JWT_SECRET` and `OTP_PEPPER` are secrets: generate random values, keep them
  out of Git and screenshots, and never put them in `VITE_*` variables.
- Never put `DATABASE_URL` (or any secret) into `VITE_*` variables — those are
  bundled into the browser app.
- Use the Supabase database password only for local development tooling, and
  never share it in issues or screenshots.
- Passwords are stored as Argon2id hashes; sessions are HTTP-only cookies with
  CSRF protection. Don't weaken these in development.
- Development data must be fake — no real student information.
