import { createApp } from './app.js';
import { env, isDatabaseConfigured } from './config/env.js';
import { closePool } from './db/pool.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`[server] API listening on http://localhost:${env.PORT} (env: ${env.NODE_ENV})`);
  console.log(`[server] application time zone: ${env.APP_TIMEZONE}`);
  if (isDatabaseConfigured) {
    console.log('[server] database: DATABASE_URL is set; connectivity is reported by GET /api/health');
  } else {
    console.warn(
      '[server] database: DATABASE_URL is not set. Copy backend/.env.example to backend/.env and fill in the Supabase connection string, then restart.',
    );
  }
});

function shutdown(signal: NodeJS.Signals): void {
  console.log(`[server] received ${signal}, shutting down gracefully...`);
  server.close(() => {
    closePool()
      .catch((error: unknown) => {
        console.error('[server] error while closing the database pool:', error instanceof Error ? error.message : error);
      })
      .finally(() => {
        process.exit(0);
      });
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
