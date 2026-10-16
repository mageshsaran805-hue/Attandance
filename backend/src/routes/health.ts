import { Router } from 'express';
import { env } from '../config/env.js';
import { checkDatabase } from '../db/pool.js';

export const healthRouter = Router();

/**
 * GET /api/health
 *
 * Reports application health and database health separately:
 *   - app.status      : "ok" whenever the API can answer at all
 *   - database.status : "ok" | "down" | "not_configured"
 *   - status          : "ok" unless a configured database is unreachable
 *
 * Never includes credentials or internal error details.
 */
healthRouter.get('/health', async (_req, res) => {
  const database = await checkDatabase();

  res.status(200).json({
    status: database.status === 'down' ? 'degraded' : 'ok',
    app: {
      status: 'ok',
      name: 'college-attendance-backend',
      timezone: env.APP_TIMEZONE,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    database,
  });
});
