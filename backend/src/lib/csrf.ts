import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * CSRF strategy: signed double-submit cookie.
 *
 * - The server issues a random value plus an HMAC signature; the pair travels
 *   in a readable (non-HTTP-only) cookie.
 * - The frontend echoes the pair in the `X-CSRF-Token` header on mutations.
 * - Requests are rejected unless the header matches the cookie and the
 *   signature verifies. Combined with SameSite=Lax session cookies and the
 *   absence of any CORS configuration, cross-site requests cannot forge it.
 */

function sign(value: string): string {
  // "csrf:" domain-separates these MACs from any other HMAC use.
  return createHmac('sha256', env.JWT_SECRET).update(`csrf:${value}`).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) {
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}

export function createCsrfToken(): string {
  const value = randomBytes(24).toString('base64url');
  return `${value}.${sign(value)}`;
}

export function isValidCsrfToken(token: string): boolean {
  const separator = token.lastIndexOf('.');
  if (separator <= 0) {
    return false;
  }
  const value = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  return safeEqual(signature, sign(value));
}

export function csrfTokensMatch(cookieToken: string, headerToken: string): boolean {
  return safeEqual(cookieToken, headerToken);
}
