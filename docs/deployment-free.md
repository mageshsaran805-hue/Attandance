# Deployment guide (free tiers: Netlify + Render)

A zero-cost way to put this system online for real: the SPA on Netlify, the
API on Render's free instance, the database on Supabase's free plan. The
architecture and security properties match [`deployment.md`](deployment.md)
— one HTTPS origin, server-side cookies, a single long-lived API process —
but the free tiers add caveats (sleeping instances, no server shell). Read
"Accepted limitations" before committing to it.

```
                                                    TLS, pinned CA
Browser ──▶ Netlify (SPA + /api proxy) ──▶ Render API (Node) ──▶ Supabase
                HTTPS                            HTTPS
```

- The browser only ever talks to the Netlify domain: Netlify serves the SPA
  and reverse-proxies `/api/*` to Render. The session cookie stays
  `Secure` + `SameSite=Lax` and the CSRF double-submit keeps working — no
  CORS, no application code changes.
- The API runs as exactly one long-lived process, so the in-memory rate
  limiters behave as designed (see [`security.md`](security.md) §13).
- Both free hosts provide HTTPS on their own subdomains, which is required
  because production cookies are `Secure`. No domain purchase is needed.

## Costs and catches

| Piece | Free tier | Catches |
| --- | --- | --- |
| Netlify | Static hosting + proxy, ~100 GB bandwidth, 300 build minutes/month | none that matter here |
| Render | Web service: 0.1 CPU / 512 MB, 750 instance-hours/month, HTTPS | sleeps after 15 idle minutes (~1 min to wake); no shell or one-off jobs; Render describes free instances as preview-grade, not production |
| Supabase | 500 MB database, 2 active projects per org | pauses after 7 days without activity; no automated backups |
| UptimeRobot | 50 monitors, 5-minute checks | none |

## 1. Production Supabase project

1. Create a new project at <https://supabase.com/dashboard> (free plan).
   Region: **South Asia (Mumbai)** for Indian data residency, or Southeast
   Asia (Singapore) to sit next to the API. Either is fine.
2. Save the database password somewhere safe (a password manager).
3. Dashboard → Project Settings → Database → SSL Configuration: download
   the CA certificate and save it on your laptop as
   `backend/certs/supabase-ca-prod.crt` (the `backend/certs/` folder is
   git-ignored — it is environment-specific and must not be shared).
4. Open Connect → **Session pooler** and copy the connection string:
   `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`

Never weaken TLS (`sslmode=no-verify`, `rejectUnauthorized: false`) — this
repository treats that as a bug, not a workaround.

## 2. Apply the schema and create the first admin (from your laptop)

Free instances have no shell, so run the one-time database setup locally
against the production URL. From the repository root:

```bash
cd backend
PROD_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=verify-full&sslrootcert=certs/supabase-ca-prod.crt'

DATABASE_URL="$PROD_URL" npm run migrate
DATABASE_URL="$PROD_URL" \
  ADMIN_EMAIL='you@college.edu' ADMIN_PASSWORD='...' ADMIN_NAME='Your Name' \
  npm run create-admin   # note: may land in shell history — clear it afterwards
unset PROD_URL
```

An inline `DATABASE_URL` overrides the one in `.env` (dotenv does not
override existing environment variables), and the relative certificate path
resolves from `backend/`. `create-admin` is idempotent — re-running resets
the password and forces `role=admin, is_active=true`. `npm run seed:dev`
must never run with a production URL.

## 3. Deploy the API on Render

The repository ships a Render Blueprint (`render.yaml`).

1. Push the repository to GitHub, then in the Render Dashboard choose
   **New → Blueprint** and select the repository (branch `main`).
2. Render reads `render.yaml` and prompts for the three secrets:
   - `JWT_SECRET` and `OTP_PEPPER`: generate each with
     `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
     (two different values).
   - `DATABASE_URL`: the same pooler string as above, but with the
     certificate at the path Render mounts secret files:
     `...?sslmode=verify-full&sslrootcert=/etc/secrets/supabase-ca.crt`
3. Apply. If Render reports the service name is taken, change `name:` in
   `render.yaml` (the name becomes the `*.onrender.com` address).
4. Upload the CA certificate: open the service → **Environment → Secret
   Files → Add**, filename `supabase-ca.crt`, contents = the certificate
   downloaded in step 1. Saving triggers a redeploy. Until this file
   exists, `/api/health` reports the database as `down` — that is expected
   for the very first deploy.
5. Verify:
   `curl -s https://<your-service>.onrender.com/api/health` — expect
   `"status":"ok"` and `"database":{"status":"ok",...}`.

Prefer clicking over Blueprints? Create a web service manually with the
same settings: Node runtime, root directory `backend`, build
`npm ci --include=dev && npm run build`, start `npm start`, plan **Free**, region
**Singapore**, health check path `/api/health`, and the environment
variables from `render.yaml`.

## 4. Deploy the SPA on Netlify

1. In this repository, edit `frontend/netlify.toml` and replace
   `REPLACE-WITH-YOUR-RENDER-SERVICE` in the proxy rule with your Render
   service name; commit and push.
2. In Netlify: **Add new site → Import an existing project**, pick the
   repository, and set the **base directory** to `frontend`. Netlify reads
   `frontend/netlify.toml` for the build command, publish directory, the
   `/api/*` proxy and the SPA fallback — no other settings, no environment
   variables (the SPA calls `/api` on its own origin).
3. Deploy, open the site, and sign in with the admin from step 2. If you
   deploy before editing the placeholder, the site loads but every API
   call fails — fix the file, push, and Netlify redeploys.

## 5. Keep the API warm

Create a free UptimeRobot account and add an HTTP(s) monitor for
`https://<your-service>.onrender.com/api/health`, checking every 5 minutes,
with an email alert. This does three jobs:

- Render sleeps a free instance after 15 idle minutes; a cold start takes
  ~1 minute, and Netlify's proxy gives up on a request after roughly 26
  seconds — so without a pinger the first request each morning can fail
  once instead of merely being slow.
- A 5-minute poll keeps the Supabase project from pausing after 7 idle
  days.
- It alerts you when the API or the database connection goes down.

One always-warm service uses at most 744 of the 750 monthly free
instance-hours (31-day month), so it fits — but do not keep a second free
web service running alongside it.

## 6. Verify the deployment

1. `curl -s https://<your-service>.onrender.com/api/health` → `"status":"ok"`,
   `"database":{"status":"ok",...}`.
2. `curl -s https://<your-site>.netlify.app/api/health` → the same JSON,
   proving the Netlify proxy reaches the API.
3. Sign in at the Netlify URL; in devtools confirm `ca_session` is
   `HttpOnly`, `Secure` and `SameSite=Lax`, and that `ca_session_csrf`
   exists (readable by the SPA on purpose).
4. Audit check: after a sign-in attempt, open the admin audit view and find
   the newest `auth.login` row — it appears immediately, proving audit
   logging works end-to-end. On this free setup the row's `ip` shows a
   proxy/CDN address rather than your personal IP; that is expected (see
   "Accepted limitations") and has no functional impact.
5. Create a department in the UI: it should save and appear in the audit
   log, proving cookies, CSRF and database writes through the proxy.

## Operating the free deployment

- **Deploys:** pushes to `main` run GitHub Actions; Render redeploys only
  when the checks pass (`autoDeployTrigger: checksPass`), Netlify rebuilds
  itself. If a Render deploy never triggers, check the CI run or switch
  `autoDeployTrigger` to `commit`.
- **Migrations:** run them from your laptop with the step 2 command before
  or after pushing a release that needs them. Migrations are forward-only;
  never edit an applied migration (the checksum check refuses to proceed).
- **Backups:** Supabase free includes no automated backups. Re-create the
  step 2 `PROD_URL`, then schedule a weekly dump from `backend/` and keep
  it off the cloud:

  ```bash
  pg_dump "$PROD_URL" -Fc -f "attendance-$(date +%F).dump"
  ```

  (Same command as [`deployment.md`](deployment.md) §7, with the pinned
  certificate.)
- **Secret rotation:** rotating `JWT_SECRET` signs everyone out; rotating
  `OTP_PEPPER` invalidates outstanding attendance codes. Change values in
  Render → Environment and redeploy.

## Accepted limitations (free setup)

- **Client IPs.** [`deployment.md`](deployment.md) §8 says to keep
  `TRUST_PROXY_HOPS=0` unless a trusted proxy is the only path to the API.
  This setup deliberately deviates and ships `TRUST_PROXY_HOPS=2`, but an
  additional CDN hop in front of `onrender.com` (the observed addresses
  fall in Cloudflare's ranges) means the app still sees a proxy/CDN
  address, not the visitor's own IP. Measured effect: audit-log `ip`
  values are CDN addresses (informational only), and the login rate
  limiter buckets failures by CDN address instead of per visitor —
  throttling still applies, just not one bucket per visitor. A spoofed
  `X-Forwarded-For` probe did not change the recorded address, so callers
  cannot choose their bucket. Nothing else is affected: sessions are
  signed JWTs and the per-student limiter keys by student account. If
  per-visitor IPs become a requirement, use the VM setup in
  [`deployment.md`](deployment.md), which removes the extra hops.
- **Sleeping API:** mitigated by the uptime monitor; otherwise the first
  request after idle takes up to a minute, or fails once behind the proxy
  (retrying succeeds).
- **Preview-grade instance:** 0.1 CPU means logins hash passwords more
  slowly than on real hardware; fine for one college, not for a crowd.
- If these matter enough (college-wide adoption, stricter security), the
  VM setup in [`deployment.md`](deployment.md) runs on free always-on VMs
  (Oracle Cloud / GCP) and removes most caveats. The application, schema
  and commands are identical — only the host changes.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| SPA loads, all API calls fail | `netlify.toml` placeholder not replaced | Edit, push, wait for the Netlify redeploy |
| First request of the day times out | Cold start | Retry once; confirm the uptime monitor is running |
| `"database":{"status":"down"}` | Secret file missing/misnamed, or `sslrootcert` path wrong in `DATABASE_URL` | Fix in Render → Environment, redeploy (a secret-file change redeploys by itself) |
| Startup error: `DATABASE_URL: must be a postgres:// or postgresql:// connection string` | The saved value is not the connection string — often a stray quote or a partial copy-paste | Render → Environment → `DATABASE_URL` → re-paste the full `postgresql://...` value (no surrounding quotes), save |
| Render asks for a different service name | `onrender.com` names are global | Change `name:` in `render.yaml` |
| Build fails: `Cannot find type definition file for 'node'` (or `tsc: not found`) | `NODE_ENV=production` makes npm skip devDependencies, so TypeScript/`@types/*` are missing | Keep `--include=dev` in the build command (`npm ci --include=dev && npm run build`), as `render.yaml` does |
| Deploy stuck waiting on checks | CI failed or did not run for that commit | Fix CI, or set `autoDeployTrigger: commit` |
| Cookie never appears after login | Site opened over `http://` or on a deploy-preview URL | Use the HTTPS site URL |

Accepted design limits shared with the main setup (single-instance rate
limits, no password-reset email, stateless sessions, audit-log growth,
report aggregation) are listed in [`security.md`](security.md) §13.
