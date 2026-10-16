import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment-variable validation.
 *
 * The process refuses to start if a variable is present but invalid, or if a
 * required secret is missing. Missing optional variables fall back to
 * development-friendly defaults. `DATABASE_URL` is intentionally optional so
 * the API can boot before Supabase credentials exist; /api/health then reports
 * the database as "not_configured" and database-backed endpoints return 503.
 */

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Secret strings must be long enough that guessing is impractical. */
const secret = (minLength: number) =>
  z
    .string()
    .trim()
    .min(minLength, `must be at least ${minLength} characters long`);

const envSchema = z.object({
  NODE_ENV: z.preprocess(
    emptyToUndefined,
    z.enum(['development', 'test', 'production']).default('development'),
  ),

  PORT: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(65535).default(4000)),

  // Number of trusted reverse-proxy hops in front of the API. Kept explicit
  // (default 0 = no proxy) so X-Forwarded-For cannot be spoofed when the API
  // is reachable directly; set to 1 behind a single reverse proxy so rate
  // limiting keys on the real client IP (see docs/deployment.md).
  TRUST_PROXY_HOPS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(10).default(0)),

  APP_TIMEZONE: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .default('Asia/Kolkata')
      .refine(isValidTimeZone, {
        message: 'must be a valid IANA time zone name, e.g. Asia/Kolkata',
      }),
  ),

  DATABASE_URL: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .refine((value) => value.startsWith('postgres://') || value.startsWith('postgresql://'), {
        message: 'must be a postgres:// or postgresql:// connection string',
      })
      .optional(),
  ),

  // Required in every environment: never invent or default a secret.
  JWT_SECRET: z.preprocess(emptyToUndefined, secret(32)),

  OTP_PEPPER: z.preprocess(emptyToUndefined, secret(32)),

  SESSION_TTL_HOURS: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(1).max(168).default(12),
  ),

  SESSION_COOKIE_NAME: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]+$/, 'may only contain letters, digits, "-" and "_"')
      .default('ca_session'),
  ),

  OTP_LENGTH: z.preprocess(emptyToUndefined, z.coerce.number().int().min(4).max(8).default(6)),

  OTP_TTL_MINUTES: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(60).default(10)),

  OTP_MAX_ATTEMPTS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(20).default(5)),
});

const parsed = envSchema.safeParse(process.env);

const SECRET_GENERATION_HINT =
  'is required. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"';

if (!parsed.success) {
  console.error('[config] Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    const path = issue.path.join('.') || '(root)';
    const isMissingSecret =
      issue.code === 'invalid_type' && (path === 'JWT_SECRET' || path === 'OTP_PEPPER');
    console.error(`  - ${path}: ${isMissingSecret ? SECRET_GENERATION_HINT : issue.message}`);
  }
  console.error('[config] Fix the values in backend/.env (see backend/.env.example) and restart.');
  process.exit(1);
}

export const env = parsed.data;

/** True when DATABASE_URL is present and syntactically valid. */
export const isDatabaseConfigured = env.DATABASE_URL !== undefined;

/** True when running with production semantics (secure cookies, etc.). */
export const isProduction = env.NODE_ENV === 'production';
