import argon2 from 'argon2';

// argon2id with the library defaults (m=64 MiB, t=3, p=4), which exceed the OWASP minimums.
const HASH_OPTIONS = { type: argon2.argon2id } as const;

let dummyHash: Promise<string> | undefined;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS);
}

export function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

/**
 * Runs a verification of comparable cost when no account exists, so login
 * response times do not reveal whether an email is registered.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= argon2.hash('dummy-password-for-timing', HASH_OPTIONS);
  await argon2.verify(await dummyHash, password);
  return false;
}
