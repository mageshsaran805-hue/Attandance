import type { Response } from 'express';
import { env, isProduction } from '../config/env.js';

/**
 * Cookie helpers. Parsing is intentionally dependency-free; setting/clearing
 * uses Express' built-in res.cookie/res.clearCookie.
 */

export const CSRF_COOKIE_NAME = `${env.SESSION_COOKIE_NAME}_csrf`;

const baseCookieOptions = {
  path: '/',
  sameSite: 'lax',
  secure: isProduction,
} as const;

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) {
    return cookies;
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) {
      continue;
    }
    const name = part.slice(0, separator).trim();
    if (name === '') {
      continue;
    }
    const rawValue = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      // Malformed percent-encoding: treat the raw value as-is is unsafe, skip.
    }
  }
  return cookies;
}

export function setSessionCookie(res: Response, token: string, maxAgeSeconds: number): void {
  res.cookie(env.SESSION_COOKIE_NAME, token, {
    ...baseCookieOptions,
    httpOnly: true,
    maxAge: maxAgeSeconds * 1_000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(env.SESSION_COOKIE_NAME, { ...baseCookieOptions, httpOnly: true });
}

export function setCsrfCookie(res: Response, token: string, maxAgeSeconds: number): void {
  // Readable by the SPA on purpose: it must echo the value in X-CSRF-Token.
  res.cookie(CSRF_COOKIE_NAME, token, {
    ...baseCookieOptions,
    httpOnly: false,
    maxAge: maxAgeSeconds * 1_000,
  });
}
