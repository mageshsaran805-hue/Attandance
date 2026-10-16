# Frontend — College Attendance Management System

React 19 + TypeScript + Vite 8 + Tailwind CSS 4.

## Commands

```bash
npm install    # install dependencies
npm run dev    # dev server at http://localhost:5173
npm run build  # type-check (tsc -b) + production build to dist/
npm run lint   # oxlint
npm run preview # serve the production build locally
```

The dev server proxies `/api/*` to the backend at `http://localhost:4000`
(see `vite.config.ts`). Start the backend first so the health indicator can
turn green. Full setup instructions: `../docs/setup.md`.

## Structure (Phase 2)

- `src/pages/LoginPage.tsx` — sign-in form (seeded demo accounts are listed
  in a collapsible note).
- `src/components/AuthProvider.tsx` — session state, backed by
  `GET /api/auth/me` (the session cookie is HTTP-only, so only the server
  knows who is signed in).
- `src/components/RequireAuth.tsx` — route guard per role; UX only, the
  backend enforces authorization on every request.
- `src/pages/dashboards/` — role home pages (placeholders until later phases).
- `src/lib/api.ts` — fetch wrapper that echoes the CSRF cookie in
  `X-CSRF-Token` on mutations.
- `src/lib/roles.ts` — role types, labels and home paths.

**Security rule:** never put `DATABASE_URL`, database passwords or other
secrets in frontend code or `VITE_*` variables — anything bundled here is
visible to every browser.
