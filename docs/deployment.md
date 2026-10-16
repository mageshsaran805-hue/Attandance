# Deployment guide (production)

How to run this system for real: a Node-hosted API, the built SPA served
from the same origin behind HTTPS, and a PostgreSQL database on Supabase.
For local development see [`setup.md`](setup.md); the reasoning behind the
security-relevant choices is in [`security.md`](security.md).

> Deploying without a budget? [`deployment-free.md`](deployment-free.md)
> covers the same architecture on free tiers (Netlify + Render + Supabase).

## 1. What you need

| Item | Notes |
| --- | --- |
| Server | Any host that can run Node.js 22+ as a long-lived process (small VM, container host, PaaS machine). Serverless functions are a poor fit: rate limiting and the database pool assume one long-lived instance. |
| Domain + HTTPS | Required. Production session cookies are `Secure`, so login cannot work over plain HTTP. The reverse-proxy example below gets certificates automatically. |
| Production Supabase project | Separate from your development project — never point production at the dev database. |
| Repository | `git clone https://github.com/mageshsaran805-hue/Attandance.git` (or your fork). |

## 2. Architecture

```
                 HTTPS (443)
Browser ─────────────────────▶ Reverse proxy ─── /api/* ──▶ Node API :4000
                                (Caddy/nginx)                    │
                                      │                           ▼
                                      └── /* ──▶ frontend/dist   Supabase PostgreSQL
                                                 (static SPA)     (TLS, pinned CA)
```

- The SPA and the API share **one origin**, so no CORS configuration is
  needed and the CSRF double-submit cookie keeps working.
- The API is a single instance. The in-memory rate limiters (per IP /
  per student) are accurate only while there is exactly one process; if you
  ever scale horizontally, put something in front or replace the limiter
  store — see [`security.md`](security.md) §13.
- Client-side routes fall back to `index.html` (SPA routing).

## 3. Production database

1. Create a new Supabase project (pick the region closest to your server).
2. Save the database password somewhere safe.
3. Dashboard → Project Settings → Database → SSL Configuration: download
   the CA certificate and save it on the server as
   `backend/certs/supabase-ca.crt` (the folder is git-ignored — it is
   environment-specific and must not be shared).
4. Copy the **session pooler** connection string and keep the pinned-cert
   parameters:
   `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=certs/supabase-ca.crt`

Never weaken TLS (`sslmode=no-verify`, `rejectUnauthorized: false`) — this
repository treats that as a bug, not a workaround.

## 4. Backend

On the server, from the repository root:

```bash
cd backend
npm ci
cp .env.example .env
# edit .env (checklist below)
```

Production `.env` checklist:

| Variable | Production value |
| --- | --- |
| `NODE_ENV` | `production` (also turns on `Secure` cookies) |
| `PORT` | `4000` (or whatever the proxy forwards to) |
| `APP_TIMEZONE` | `Asia/Kolkata` |
| `JWT_SECRET` | Fresh random value, never reused from dev |
| `OTP_PEPPER` | Fresh random value, separate from `JWT_SECRET` |
| `DATABASE_URL` | Production project, `sslmode=verify-full` + pinned cert |
| `TRUST_PROXY_HOPS` | `1` behind the reverse proxy below; `0` if clients reach the API directly |

Generate the two secrets with
`node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.

Apply the schema and create the first administrator:

```bash
npm run migrate        # forward-only, checksummed
ADMIN_EMAIL=you@college.edu ADMIN_PASSWORD='...' ADMIN_NAME='Your Name' \
  npm run create-admin # note: may land in shell history — clear it afterwards
```

Then build and run:

```bash
npm run build
npm start              # node dist/index.js
```

`create-admin` is idempotent: re-running with the same email resets the
password and forces `role=admin, is_active=true`. Everything after the
first admin (departments, HOD/faculty accounts, classes, enrollments) is
created through the UI. `npm run seed:dev` refuses to run with
`NODE_ENV=production` and must never be used there.

Run the API under a process supervisor so it restarts on failure. Example
systemd unit (`/etc/systemd/system/attendance-api.service`):

```ini
[Unit]
Description=College Attendance API
After=network-online.target

[Service]
User=attendance
WorkingDirectory=/srv/college-attendance/backend
EnvironmentFile=/srv/college-attendance/backend/.env
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

`WorkingDirectory` matters: the relative `certs/supabase-ca.crt` path in
`DATABASE_URL` is resolved from it.

## 5. Frontend + reverse proxy

```bash
cd frontend
npm ci
npm run build          # writes frontend/dist/
```

Serve `frontend/dist` as static files and reverse-proxy `/api/*` to the
API. Caddy example (`/etc/caddy/Caddyfile`) — certificates are automatic:

```
attendance.example.edu {
    encode gzip

    handle /api/* {
        reverse_proxy 127.0.0.1:4000
    }

    handle {
        root * /srv/college-attendance/frontend/dist
        try_files {path} /index.html
        file_server
    }
}
```

Any web server works; with nginx the equivalents are
`try_files $uri /index.html;` for the static root and
`proxy_pass http://127.0.0.1:4000;` for `/api/`. Behind a proxy, set
`TRUST_PROXY_HOPS=1` so rate limiting sees real client IPs instead of the
proxy's.

## 6. Verify the deployment

1. `curl -s https://attendance.example.edu/api/health` — expect
   `"status":"ok"` and `"database":{"status":"ok",...}`.
2. Sign in at `https://attendance.example.edu` with the bootstrapped admin.
   In the browser devtools, confirm the session cookie is `HttpOnly`,
   `Secure` and `SameSite=Lax`.
3. Create a department, a HOD account and a class; the admin audit view
   should list each action.
4. Remember the session is a cookie: the site must be opened over HTTPS,
   not plain HTTP (production cookies are `Secure` by design).

## 7. Operating it

- **Deploys:** `git pull && npm ci && npm run migrate && npm run build`
  (backend) and `git pull && npm ci && npm run build` (frontend), then
  restart the API service. Migrations are forward-only; never edit a
  migration that has been applied (the checksum check makes the runner
  refuse to proceed).
- **Backups:** enable Supabase backups for the project and/or schedule
  `pg_dump "$DATABASE_URL" -Fc -f attendance-$(date +%F).dump` with the
  same pinned cert; keep dumps off the server.
- **Logs:** the API logs to stdout/stderr (`journalctl -u attendance-api -f`
  under systemd).
- **Monitoring:** poll `GET /api/health`; alert when the HTTP status is not
  200 or when `database.status` is not `ok`.
- **Secret rotation:** rotating `JWT_SECRET` invalidates all sessions
  (everyone signs in again); rotating `OTP_PEPPER` invalidates outstanding
  attendance codes (faculty regenerate them); the database password is
  rotated in Supabase and then updated in `DATABASE_URL`.

## 8. Security reminders

- Keep `TRUST_PROXY_HOPS=0` unless a trusted reverse proxy is the only path
  to the API — otherwise clients can spoof `X-Forwarded-For`.
- Keep `backend/.env` and `backend/certs/` on the server only; both are
  git-ignored — check `git status` after any edit.
- Use a read-only deploy key (or a dedicated fine-grained token) for the
  server's clone; do not copy a personal access token to the server.
- The dev seed, demo accounts and `Demo@12345` exist for development only.
  Production accounts must be real, with passwords communicated securely.

Accepted design limits (single-instance rate limits, no password-reset
email, stateless sessions, audit-log growth, report aggregation) are listed
in [`security.md`](security.md) §13.
