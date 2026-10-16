/**
 * Error type for expected API failures. The error handler maps it to a JSON
 * response with the given status; anything else is treated as an unexpected
 * internal error and logged server-side only.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Guards statements that must return a row (INSERT/UPDATE ... RETURNING).
 * A missing row means an application bug, so it becomes a generic 500 rather
 * than a confusing type error.
 */
export function expectRow<T>(row: T | undefined, context: string): T {
  if (row === undefined) {
    throw new Error(`${context}: expected a returned row but got none`);
  }
  return row;
}
