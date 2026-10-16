import { describe, expect, it } from 'vitest';
import { createCsrfToken, csrfTokensMatch, isValidCsrfToken } from './csrf.js';

describe('CSRF signed double-submit tokens', () => {
  it('issues tokens that validate', () => {
    const token = createCsrfToken();
    expect(isValidCsrfToken(token)).toBe(true);
  });

  it('issues a fresh value every time', () => {
    expect(createCsrfToken()).not.toBe(createCsrfToken());
  });

  it('rejects tokens with a tampered payload', () => {
    const token = createCsrfToken();
    const separator = token.lastIndexOf('.');
    const value = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    const tamperedValue = (value[0] === 'A' ? 'B' : 'A') + value.slice(1);

    expect(isValidCsrfToken(`${tamperedValue}.${signature}`)).toBe(false);
  });

  it('rejects tokens with a tampered signature', () => {
    const token = createCsrfToken();
    const separator = token.lastIndexOf('.');
    const value = token.slice(0, separator);
    const signature = token.slice(separator + 1);
    const tamperedSignature = signature.slice(0, -1) + (signature.endsWith('A') ? 'B' : 'A');

    expect(isValidCsrfToken(`${value}.${tamperedSignature}`)).toBe(false);
  });

  it('rejects malformed or unsigned tokens', () => {
    expect(isValidCsrfToken('')).toBe(false);
    expect(isValidCsrfToken('no-separator')).toBe(false);
    expect(isValidCsrfToken('.signature-only')).toBe(false);
    expect(isValidCsrfToken('value.')).toBe(false);
  });

  it('matches only identical tokens', () => {
    const first = createCsrfToken();
    const second = createCsrfToken();

    expect(csrfTokensMatch(first, first)).toBe(true);
    expect(csrfTokensMatch(first, second)).toBe(false);
    expect(csrfTokensMatch(first, 'short')).toBe(false);
    expect(csrfTokensMatch('short', first)).toBe(false);
  });
});
