import { ApiError } from './errors.js';

/**
 * PostgreSQL error inspection helpers. Routes use these to translate
 * database-level integrity violations into clear 4xx responses instead of
 * leaking constraint details as 500s.
 */

interface PgErrorLike {
  code?: string;
  constraint?: string;
}

function asPgError(error: unknown): PgErrorLike | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return error as PgErrorLike;
  }
  return null;
}

export const PG_UNIQUE_VIOLATION = '23505';
export const PG_FOREIGN_KEY_VIOLATION = '23503';
export const PG_CHECK_VIOLATION = '23514';

/**
 * Maps known unique-constraint violations to friendly 409 ApiErrors.
 * `overrides` maps constraint names to messages; `fallback` covers the rest.
 */
export function throwIfUniqueViolation(
  error: unknown,
  overrides: Record<string, string>,
  fallback: string,
): never {
  const pgError = asPgError(error);
  if (pgError?.code === PG_UNIQUE_VIOLATION) {
    const message = pgError.constraint !== undefined ? (overrides[pgError.constraint] ?? fallback) : fallback;
    throw new ApiError(409, message);
  }
  throw error;
}
