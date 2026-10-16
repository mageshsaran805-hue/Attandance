import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env.js';
import { clearSessionCookie, setCsrfCookie, setSessionCookie } from '../lib/cookies.js';
import { createCsrfToken } from '../lib/csrf.js';
import { DUMMY_PASSWORD_HASH, verifyPassword } from '../lib/password.js';
import { issueSessionToken } from '../lib/tokens.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { logAudit } from '../services/audit.js';
import { findUserByEmail, type UserRow } from '../services/users.js';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().trim().max(320).pipe(z.email('must be a valid email address')),
  password: z.string().min(1, 'is required').max(200),
});

type LoginInput = z.infer<typeof loginSchema>;

/**
 * Login throttling: 10 failed attempts per IP per 15 minutes. Successful
 * logins are not counted, so typo-then-success does not lock anyone out.
 */
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many login attempts. Try again in a few minutes.' });
  },
});

function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
  };
}

/**
 * POST /api/auth/login
 *
 * Verifies credentials, then issues an HTTP-only session cookie. Unknown
 * emails still run a dummy hash verification so response timing does not
 * reveal whether an account exists. Failures are audit-logged without
 * passwords or other credentials.
 */
authRouter.post('/auth/login', loginRateLimiter, validateBody(loginSchema), async (req, res) => {
  const { email, password } = req.body as LoginInput;
  const ip = req.ip ?? null;

  const user = await findUserByEmail(email);
  const passwordOk = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password);

  if (!user || !passwordOk) {
    await logAudit({
      // No authenticated actor: the request had no session. The targeted
      // account (when it exists) is recorded as the entity instead.
      actorUserId: null,
      action: 'auth.login_failed',
      entityType: 'user',
      entityId: user?.id ?? 'unauthenticated',
      newValue: { reason: 'invalid_credentials', attemptedEmail: email },
      ip,
    });
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  if (!user.isActive) {
    await logAudit({
      // Credentials were correct, but the account is deactivated — still not
      // an authenticated session; record the account as the entity.
      actorUserId: null,
      action: 'auth.login_denied',
      entityType: 'user',
      entityId: user.id,
      newValue: { reason: 'account_inactive' },
      ip,
    });
    res.status(403).json({ error: 'This account has been deactivated. Contact the administrator.' });
    return;
  }

  const ttlSeconds = env.SESSION_TTL_HOURS * 3_600;
  const token = await issueSessionToken(user.id, ttlSeconds);
  setSessionCookie(res, token, ttlSeconds);
  // Rotate the CSRF token at login (session-fixation hygiene).
  setCsrfCookie(res, createCsrfToken(), ttlSeconds);
  await logAudit({
    actorUserId: user.id,
    action: 'auth.login',
    entityType: 'user',
    entityId: user.id,
    ip,
  });

  res.json({ user: publicUser(user) });
});

/** POST /api/auth/logout — clears the session cookie. */
authRouter.post('/auth/logout', requireAuth, async (req, res) => {
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  clearSessionCookie(res);
  await logAudit({
    actorUserId: user.id,
    action: 'auth.logout',
    entityType: 'user',
    entityId: user.id,
    ip: req.ip ?? null,
  });
  res.status(204).end();
});

/** GET /api/auth/me — the current session's user, or 401. */
authRouter.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
