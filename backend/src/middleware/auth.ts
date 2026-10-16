import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { env } from '../config/env.js';
import { parseCookies } from '../lib/cookies.js';
import { ApiError } from '../lib/errors.js';
import { verifySessionToken } from '../lib/tokens.js';
import { findActiveUserById, type UserRole } from '../services/users.js';

/**
 * Authentication and role middleware.
 *
 * The session cookie carries only the user id; the account (role, active
 * status) is re-read from the database on every request so deactivation and
 * role changes take effect immediately.
 */

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = parseCookies(req.headers.cookie)[env.SESSION_COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const session = await verifySessionToken(token);
  if (!session) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const user = await findActiveUserById(session.userId);
  if (!user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  req.user = {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
  };
  next();
}

/** Route guard for specific roles; must run after requireAuth. */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (!roles.includes(user.role)) {
      res.status(403).json({ error: 'You do not have permission to perform this action' });
      return;
    }
    next();
  };
}

/**
 * The authenticated user's id, for handlers that were already guarded by
 * requireAuth. A missing user means the route was wired incorrectly, so it
 * surfaces as 401 instead of passing `undefined` into database queries.
 */
export function authenticatedUserId(req: Request): string {
  const user = req.user;
  if (!user) {
    throw new ApiError(401, 'Authentication required');
  }
  return user.id;
}
