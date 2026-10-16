import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { CSRF_COOKIE_NAME, parseCookies, setCsrfCookie } from '../lib/cookies.js';
import { createCsrfToken, csrfTokensMatch, isValidCsrfToken } from '../lib/csrf.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_HEADER = 'x-csrf-token';

/**
 * Ensures every visitor holds a valid signed CSRF cookie before they need one
 * (the SPA reads it and echoes it back on mutations).
 */
export function ensureCsrfCookie(req: Request, res: Response, next: NextFunction): void {
  const provided = parseCookies(req.headers.cookie)[CSRF_COOKIE_NAME];
  if (!provided || !isValidCsrfToken(provided)) {
    setCsrfCookie(res, createCsrfToken(), env.SESSION_TTL_HOURS * 3_600);
  }
  next();
}

/**
 * Rejects state-changing requests whose X-CSRF-Token header does not match
 * the signed CSRF cookie.
 */
export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const cookieToken = parseCookies(req.headers.cookie)[CSRF_COOKIE_NAME];
  const headerValue = req.headers[CSRF_HEADER];
  const headerToken = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (
    !cookieToken ||
    !headerToken ||
    !isValidCsrfToken(cookieToken) ||
    !csrfTokensMatch(cookieToken, headerToken)
  ) {
    res.status(403).json({ error: 'Invalid or missing CSRF token' });
    return;
  }

  next();
}
