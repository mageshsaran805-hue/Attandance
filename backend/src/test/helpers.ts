import type { Response } from 'supertest';

/**
 * Cookie helpers for API tests. Supertest has no built-in cookie jar, so
 * tests manage Set-Cookie values explicitly.
 */

function setCookieHeaders(res: Response): string[] {
  const raw = res.headers['set-cookie'] as string | string[] | undefined;
  if (!raw) {
    return [];
  }
  return Array.isArray(raw) ? raw : [raw];
}

/** "name=value; name2=value2" from every Set-Cookie on the response. */
export function cookieHeaderFrom(res: Response): string {
  return setCookieHeaders(res)
    .map((entry) => entry.split(';')[0] ?? '')
    .filter((pair) => pair !== '')
    .join('; ');
}

export function cookieValue(res: Response, name: string): string | undefined {
  for (const entry of setCookieHeaders(res)) {
    const pair = entry.split(';')[0] ?? '';
    const separator = pair.indexOf('=');
    if (separator > 0 && pair.slice(0, separator) === name) {
      return pair.slice(separator + 1);
    }
  }
  return undefined;
}
