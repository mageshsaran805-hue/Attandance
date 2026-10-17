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
    const [header, payload, signature] = token.split('.') as [string, string, string];
    // Flip the first character of the signature. Every base64url character
    // except the final one carries six significant bits, so the first
    // character always changes the decoded signature bytes; the final
    // character only carries four, so flipping it can decode identically.
    const tampered = `${header}.${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;

    await expect(verifySessionToken(tampered)).resolves.toBeNull();
  });

  it('rejects malformed values', async () => {
    await expect(verifySessionToken('not-a-token')).resolves.toBeNull();
    await expect(verifySessionToken('')).resolves.toBeNull();
    await expect(verifySessionToken('a.b.c')).resolves.toBeNull();
  });
});
