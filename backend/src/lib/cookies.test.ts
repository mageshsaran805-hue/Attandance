import { describe, expect, it } from 'vitest';
import { parseCookies } from './cookies.js';

describe('cookie header parsing', () => {
  it('parses multiple pairs and trims whitespace', () => {
    expect(parseCookies('a=1; b=two; c=3')).toEqual({ a: '1', b: 'two', c: '3' });
  });

  it('decodes percent-encoded values', () => {
    expect(parseCookies('token=abc%2Edef%2Dghi')).toEqual({ token: 'abc.def-ghi' });
  });

  it('keeps empty values and skips malformed pairs', () => {
    expect(parseCookies('empty=; broken; =orphan; x=9')).toEqual({ empty: '', x: '9' });
  });

  it('skips values with invalid percent-encoding instead of throwing', () => {
    expect(parseCookies('bad=%E0%A4%A')).toEqual({});
  });

  it('returns an empty object for missing or blank headers', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });
});
