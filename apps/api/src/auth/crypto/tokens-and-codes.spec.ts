import { generateOneTimeCode, hashOneTimeCode, oneTimeCodeMatches } from './one-time-code';
import {
  formatRefreshToken,
  generateRefreshSecret,
  hashRefreshSecret,
  parseRefreshToken,
  refreshSecretMatches,
} from './refresh-token';

const SECRET = 'unit-test-otp-secret-0123456789abcdef';
const TENANT = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const SESSION = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c';

describe('one-time codes', () => {
  it('generates 6-digit numeric codes', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateOneTimeCode()).toMatch(/^\d{6}$/);
    }
  });

  it('matches only the right code for the right challenge', () => {
    const stored = hashOneTimeCode(SECRET, 'challenge-1', '123456');
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(oneTimeCodeMatches(SECRET, 'challenge-1', '123456', stored)).toBe(true);
    expect(oneTimeCodeMatches(SECRET, 'challenge-1', '123457', stored)).toBe(false);
    expect(oneTimeCodeMatches(SECRET, 'challenge-2', '123456', stored)).toBe(false);
    expect(
      oneTimeCodeMatches('another-secret-0123456789abcdefgh', 'challenge-1', '123456', stored),
    ).toBe(false);
  });
});

describe('refresh tokens', () => {
  it('round-trips the token format', () => {
    const secret = generateRefreshSecret();
    const token = formatRefreshToken({
      tenantId: TENANT,
      sessionId: SESSION,
      generation: 3,
      secret,
    });
    expect(parseRefreshToken(token)).toEqual({
      tenantId: TENANT,
      sessionId: SESSION,
      generation: 3,
      secret,
    });
  });

  it.each([
    '',
    'rt1.not-a-uuid.x.0.y',
    `rt2.${TENANT}.${SESSION}.0.${'a'.repeat(43)}`,
    `rt1.${TENANT}.${SESSION}.-1.${'a'.repeat(43)}`,
    `rt1.${TENANT}.${SESSION}.0.${'a'.repeat(42)}`,
  ])('rejects malformed token %j', (value) => {
    expect(parseRefreshToken(value)).toBeNull();
  });

  it('stores only a hash and compares in constant time', () => {
    const secret = generateRefreshSecret();
    const stored = hashRefreshSecret(secret);
    expect(stored).not.toContain(secret);
    expect(refreshSecretMatches(secret, stored)).toBe(true);
    expect(refreshSecretMatches(generateRefreshSecret(), stored)).toBe(false);
  });
});
