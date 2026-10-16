import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../lib/errors.js';

/**
 * Express' body parsers attach a 4xx `status` and a `type` to their errors
 * (e.g. 'entity.parse.failed' for malformed JSON). Those are client mistakes
 * and must not surface as 500s.
 */
function asBodyParserError(error: unknown): { status: number; message: string } | null {
  if (typeof error !== 'object' || error === null) {
    return null;
  }
  const candidate = error as { status?: unknown; type?: unknown };
  const status = typeof candidate.status === 'number' ? candidate.status : undefined;
  if (status === undefined || status < 400 || status >= 500) {
    return null;
  }
  const type = typeof candidate.type === 'string' ? candidate.type : '';
  if (type === 'entity.parse.failed') {
    return { status, message: 'Malformed JSON body.' };
  }
  if (type === 'entity.too.large') {
    return { status, message: 'Request body too large.' };
  }
  if (type === 'encoding.unsupported') {
    return { status, message: 'Unsupported content encoding.' };
  }
  return null;
}

/**
 * Final error handler. Expected failures (ApiError) produce their safe JSON
 * message, client-caused body-parser failures keep their 4xx status; anything
 * else is logged server-side and returned as a generic 500 so internal
 * details and stack traces are never leaked to clients.
 */
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  const bodyParserError = asBodyParserError(error);
  if (bodyParserError) {
    res.status(bodyParserError.status).json({ error: bodyParserError.message });
    return;
  }

  console.error('[api] unhandled error:', error instanceof Error ? (error.stack ?? error.message) : error);
  res.status(500).json({ error: 'Internal server error' });
}
