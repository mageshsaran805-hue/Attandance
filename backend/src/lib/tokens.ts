import { SignJWT, jwtVerify } from 'jose';
import { env } from '../config/env.js';

/**
 * Login session tokens: HS256 JWTs carried in an HTTP-only cookie.
 * The token only identifies the user (subject); role and active status are
 * re-read from the database on every request, never trusted from the token.
 */

const signingKey = new TextEncoder().encode(env.JWT_SECRET);

export interface SessionTokenPayload {
  userId: string;
}

export async function issueSessionToken(userId: string, ttlSeconds: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(signingKey);
}

export async function verifySessionToken(token: string): Promise<SessionTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey, { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || payload.sub === '') {
      return null;
    }
    return { userId: payload.sub };
  } catch {
    // Expired, malformed or wrong-signature tokens are all "no session".
    return null;
  }
}
