import { describe, expect, it } from 'vitest';
import { issueSessionToken, verifySessionToken } from './tokens.js';

const USER_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('session tokens (HS256 JWT)', () => {
  it('round-trips the user id', async () => {
    const token = await issueSessionToken(USER_ID, 3_600);

    await expect(verifySessionToken(token)).resolves.toEqual({ userId: USER_ID });
  });

  it('rejects expired tokens', async () => {
    const token = await issueSessionToken(USER_ID, -10);

    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it('rejects tampered tokens', async () => {
    const token = await issueSessionToken(USER_ID, 3_600);
    const lastChar = token.slice(-1);
    const tampered = token.slice(0, -1) + (lastChar === 'A' ? 'B' : 'A');

    await expect(verifySessionToken(tampered)).resolves.toBeNull();
  });

  it('rejects malformed values', async () => {
    await expect(verifySessionToken('not-a-token')).resolves.toBeNull();
    await expect(verifySessionToken('')).resolves.toBeNull();
    await expect(verifySessionToken('a.b.c')).resolves.toBeNull();
  });
});
