import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/errors.js';

/**
 * Final error handler. Expected failures (ApiError) produce their safe JSON
 * message; anything else is logged server-side and returned as a generic 500
 * so internal details and stack traces are never leaked to clients.
 */
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  console.error('[api] unhandled error:', error instanceof Error ? (error.stack ?? error.message) : error);
  res.status(500).json({ error: 'Internal server error' });
}
