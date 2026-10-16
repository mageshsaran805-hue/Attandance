# Database migrations

Numbered, forward-only SQL migrations for the Supabase-hosted PostgreSQL
database, applied by the runner in `backend/src/db/migrate.ts`.

**Phase 2 status:** `0001_core_schema.sql` creates the full schema designed in
[`../../docs/database-design.md`](../../docs/database-design.md).

## Conventions

- File names: `NNNN_short_description.sql` (zero-padded, lowercase, e.g.
  `0001_core_schema.sql`). Numbers must be unique; files are applied in
  numerical order.
- One logical change per file.
- **Do not add `BEGIN;`/`COMMIT;`** — the runner wraps each file in a
  transaction together with its bookkeeping row, so a failed migration leaves
  nothing partially applied.
- Never edit a migration that has been applied anywhere (the runner verifies
  a SHA-256 checksum and refuses); add a new numbered file instead.
- Drop/rename/type-change statements require explicit human review.
- Every migration that creates tables must also enable row-level security on
  them and revoke privileges from the Supabase `anon`/`authenticated` roles,
  following the pattern at the end of `0001_core_schema.sql`.

## How to apply

With `DATABASE_URL` configured in `backend/.env`:

```bash
cd backend
npm run migrate
```

The runner:

1. takes a session-wide advisory lock (concurrent runs wait, never interleave),
2. creates `schema_migrations` if missing (and locks it down like the rest),
3. applies pending files in order inside individual transactions,
4. records `filename`, `checksum` and `applied_at` for each,
5. refuses to run if an already-applied file's content has changed,
6. warns about recorded files that no longer exist locally.

Never run migrations against a database you do not intend to change. The
development-seed script (`npm run seed:dev`) is separate from migrations and
refuses to run with `NODE_ENV=production`.
