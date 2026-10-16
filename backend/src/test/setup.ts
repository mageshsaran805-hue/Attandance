import { randomBytes } from 'node:crypto';

/**
 * Test bootstrap: runs before any test file imports application modules.
 *
 * 1. Provides fake JWT_SECRET / OTP_PEPPER values when the environment does
 *    not have them, so config validation passes without a real .env.
 * 2. Forces DATABASE_URL to TEST_DATABASE_URL (or empty). Tests therefore
 *    never connect to the development database, even when backend/.env
 *    exists: `dotenv/config` does not overwrite already-set variables.
 *    Database-backed tests are skipped unless TEST_DATABASE_URL is provided.
 */

process.env.NODE_ENV = 'test';

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = randomBytes(48).toString('base64url');
}

if (!process.env.OTP_PEPPER) {
  process.env.OTP_PEPPER = randomBytes(48).toString('base64url');
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? '';
