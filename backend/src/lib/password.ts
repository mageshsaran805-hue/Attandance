import { hash, verify } from '@node-rs/argon2';

/**
 * Password hashing with Argon2id.
 *
 * Parameters follow the OWASP recommendation (19 MiB memory, 2 iterations,
 * 1 lane). They are encoded inside every produced hash, so changing them later
 * does not invalidate existing hashes.
 *
 * `algorithm: 2` is Algorithm.Argon2id from @node-rs/argon2; the package
 * declares it as an ambient const enum, which TypeScript refuses to access
 * when `verbatimModuleSyntax` is enabled.
 */
const HASH_OPTIONS = {
  algorithm: 2,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, HASH_OPTIONS);
}

/** Returns false (instead of throwing) for malformed stored hashes. */
export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, HASH_OPTIONS);
  } catch {
    return false;
  }
}

/**
 * A valid Argon2id hash of a random throwaway string that is not a password
 * anywhere. Login verifies against this when the email is unknown so that
 * response timing does not reveal whether an account exists.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$cNobU2z1JRjYM62QtKd5jw$xBpAavPSwYeamzHen00z2+uYavTLQ3/Ia/whoWIFnwg';
