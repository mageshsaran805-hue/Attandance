import type { RequestHandler } from 'express';
import type { z } from 'zod';
import { ApiError } from '../lib/errors.js';

/**
 * Validates req.body against a zod schema and replaces it with the parsed
 * (trimmed, typed) result. Failures return a safe 400 with per-field issues.
 */
export function validateBody<S extends z.ZodType>(schema: S): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Invalid request body',
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Validates req.params against a zod schema (e.g. uuid path segments) so a
 * malformed id returns a clear 400 instead of reaching the database.
 */
export function validateParams<S extends z.ZodType>(schema: S): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      res.status(400).json({ error: 'Invalid request parameters' });
      return;
    }
    req.params = result.data as typeof req.params;
    next();
  };
}

/**
 * Parses req.query against a zod schema and returns the typed result.
 * Unlike validateBody it does not assign back to req.query (Express 5
 * exposes req.query as a getter), so handlers use the return value.
 */
export function parseQuery<S extends z.ZodType>(query: unknown, schema: S): z.infer<S> {
  const result = schema.safeParse(query);
  if (!result.success) {
    throw new ApiError(400, 'Invalid query parameters');
  }
  return result.data;
}
