import express, { type Express } from 'express';
import { env } from './config/env.js';
import { ensureCsrfCookie, requireCsrf } from './middleware/csrf.js';
import { errorHandler } from './middleware/error-handler.js';
import { adminRouter } from './routes/admin.js';
import { attendanceRouter } from './routes/attendance.js';
import { authRouter } from './routes/auth.js';
import { facultyRouter } from './routes/faculty.js';
import { healthRouter } from './routes/health.js';
import { hodRouter } from './routes/hod.js';
import { reportsRouter } from './routes/reports.js';

/**
 * Builds the Express application. Kept separate from server startup
 * (see index.ts) so the app can be imported and tested without listening
 * on a port.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');

  // Behind a reverse proxy the real client IPs arrive in X-Forwarded-For;
  // the hop count is explicit (default 0 = direct connections only) so the
  // header cannot be spoofed when the API is exposed directly. Rate limiting
  // keys on req.ip, so this must match the deployment topology.
  if (env.TRUST_PROXY_HOPS > 0) {
    app.set('trust proxy', env.TRUST_PROXY_HOPS);
  }

  // Dependency-free security headers; the API only ever serves JSON.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use(express.json({ limit: '100kb' }));

  // Every /api request gets a signed CSRF cookie if it does not have one;
  // state-changing methods must echo it back in X-CSRF-Token.
  app.use('/api', ensureCsrfCookie);
  app.use('/api', requireCsrf);

  app.use('/api', healthRouter);
  app.use('/api', authRouter);
  app.use('/api', adminRouter);
  app.use('/api', hodRouter);
  app.use('/api', facultyRouter);
  app.use('/api', attendanceRouter);
  app.use('/api', reportsRouter);

  // Unknown routes: JSON response instead of Express' default HTML page.
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(errorHandler);

  return app;
}
