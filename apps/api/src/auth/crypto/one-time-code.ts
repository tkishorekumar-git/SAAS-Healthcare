import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

export const ONE_TIME_CODE_LENGTH = 6;

/** Uniformly random 6-digit code from a CSPRNG. */
export function generateOneTimeCode(): string {
  return randomInt(0, 10 ** ONE_TIME_CODE_LENGTH)
    .toString()
    .padStart(ONE_TIME_CODE_LENGTH, '0');
}

/**
 * HMAC bound to the challenge ID, so a stolen hash is useless for any other challenge
 * and the 1-in-a-million code space cannot be brute-forced offline without the secret.
 */
export function hashOneTimeCode(secret: string, challengeId: string, code: string): string {
  return createHmac('sha256', secret).update(`${challengeId}:${code}`).digest('hex');
}

export function oneTimeCodeMatches(
  secret: string,
  challengeId: string,
  code: string,
  storedHash: string,
): boolean {
  const candidate = Buffer.from(hashOneTimeCode(secret, challengeId, code), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}
