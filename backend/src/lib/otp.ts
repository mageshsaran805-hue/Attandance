import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Attendance OTP helpers.
 *
 * The raw OTP is returned to the faculty member who generated it and shown to
 * the class; the database only ever stores an HMAC-SHA-256 hash keyed with
 * OTP_PEPPER (attendance_sessions.otp_hash), so a database leak does not
 * reveal usable codes.
 */

const OTP_MAX = 10 ** env.OTP_LENGTH;

/** Random OTP with a fixed number of digits (leading zeros kept). */
export function generateOtp(): string {
  return String(randomInt(0, OTP_MAX)).padStart(env.OTP_LENGTH, '0');
}

export function hashOtp(otp: string): string {
  return createHmac('sha256', env.OTP_PEPPER).update(otp).digest('hex');
}

/** Constant-time comparison of a candidate OTP against a stored hash. */
export function otpMatches(candidate: string, storedHash: string): boolean {
  const computed = Buffer.from(hashOtp(candidate), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return computed.length === stored.length && timingSafeEqual(computed, stored);
}

/** Validation pattern for request bodies, e.g. /^\d{6}$/. */
export function otpInputPattern(): RegExp {
  return new RegExp(`^\\d{${env.OTP_LENGTH}}$`);
}
