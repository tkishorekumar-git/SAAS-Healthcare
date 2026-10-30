import { Algorithm, hash, verify } from '@node-rs/argon2';
import { PASSWORD_MAX_LENGTH } from './password-policy';

/** OWASP-recommended Argon2id parameters (19 MiB memory, 2 iterations, 1 lane). */
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Verified when an account does not exist, so a failed login takes the same time
 * whether or not the account is real (prevents account enumeration by timing).
 */
const DUMMY_HASH_INPUT = 'kenisha-timing-equaliser';
let dummyHash: Promise<string> | undefined;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(
  password: string,
  storedHash: string | null,
): Promise<boolean> {
  if (password.length > PASSWORD_MAX_LENGTH) {
    return false;
  }
  if (storedHash === null) {
    dummyHash ??= hash(DUMMY_HASH_INPUT, OPTIONS);
    await verify(await dummyHash, password);
    return false;
  }
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}
