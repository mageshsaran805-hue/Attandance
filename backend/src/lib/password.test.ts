import { describe, expect, it } from 'vitest';
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from './password.js';

describe('password hashing (argon2id)', () => {
  it('verifies the correct password and rejects a wrong one', async () => {
    const storedHash = await hashPassword('S3cret-Passphrase!');

    expect(storedHash.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword(storedHash, 'S3cret-Passphrase!')).resolves.toBe(true);
    await expect(verifyPassword(storedHash, 'wrong-password')).resolves.toBe(false);
  });

  it('produces a different hash for the same password (random salt)', async () => {
    const first = await hashPassword('same-password');
    const second = await hashPassword('same-password');

    expect(first).not.toBe(second);
    await expect(verifyPassword(first, 'same-password')).resolves.toBe(true);
    await expect(verifyPassword(second, 'same-password')).resolves.toBe(true);
  });

  it('rejects malformed stored hashes without throwing', async () => {
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
    await expect(verifyPassword('', 'anything')).resolves.toBe(false);
  });

  it('the dummy hash is a valid argon2id hash that matches no known input', async () => {
    expect(DUMMY_PASSWORD_HASH.startsWith('$argon2id$')).toBe(true);
    await expect(verifyPassword(DUMMY_PASSWORD_HASH, 'password')).resolves.toBe(false);
  });
});
