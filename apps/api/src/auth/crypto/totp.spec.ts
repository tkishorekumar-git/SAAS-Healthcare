import { randomBytes } from 'node:crypto';
import { createCipheriv } from 'node:crypto';
import {
  loadSecretBoxKey,
  needsReseal,
  openSecret,
  sealSecret,
  secretBoxKeyId,
} from './secret-box';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  totpCodeForStep,
  totpProvisioningUri,
  totpStep,
  verifyTotp,
} from './totp';

// RFC 6238 Appendix B test secret ("12345678901234567890", SHA-1).
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP (RFC 6238)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('matches the RFC test vector at T=%i', (seconds, expected) => {
    expect(totpCodeForStep(RFC_SECRET, Math.floor(seconds / 30), 8)).toBe(expected);
  });

  it('accepts the current code and one step of clock drift either way', () => {
    const secret = generateTotpSecret();
    const now = new Date('2026-10-30T10:00:15Z');
    const step = totpStep(now);
    for (const delta of [-1, 0, 1]) {
      expect(verifyTotp(secret, totpCodeForStep(secret, step + delta), now, null)).toBe(
        step + delta,
      );
    }
    expect(verifyTotp(secret, totpCodeForStep(secret, step + 2), now, null)).toBeNull();
    expect(verifyTotp(secret, totpCodeForStep(secret, step - 2), now, null)).toBeNull();
  });

  it('never accepts a code from an already-used step (replay)', () => {
    const secret = generateTotpSecret();
    const now = new Date('2026-10-30T10:00:15Z');
    const step = totpStep(now);
    const code = totpCodeForStep(secret, step);
    expect(verifyTotp(secret, code, now, step - 1)).toBe(step);
    expect(verifyTotp(secret, code, now, step)).toBeNull();
  });

  it('rejects malformed codes', () => {
    const secret = generateTotpSecret();
    for (const code of ['', '12345', '1234567', 'abcdef']) {
      expect(verifyTotp(secret, code, new Date(), null)).toBeNull();
    }
  });

  it('round-trips base32 and generates 160-bit secrets', () => {
    const bytes = randomBytes(20);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(generateTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });

  it('builds an otpauth URI authenticator apps understand', () => {
    const uri = totpProvisioningUri('JBSWY3DPEHPK3PXP', 'super@example.test');
    expect(uri).toMatch(/^otpauth:\/\/totp\/Kenisha%20Healthcare%3Asuper%40example\.test\?/);
    expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
    expect(uri).toContain('period=30');
  });
});

describe('secret box (AES-256-GCM)', () => {
  const key = loadSecretBoxKey(randomBytes(32).toString('base64'));

  it('round-trips and never stores the plaintext', () => {
    const sealed = sealSecret('JBSWY3DPEHPK3PXP', key);
    expect(sealed.startsWith(`v2.${secretBoxKeyId(key)}.`)).toBe(true);
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(openSecret(sealed, key)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('uses a fresh IV every time', () => {
    expect(sealSecret('same', key)).not.toBe(sealSecret('same', key));
  });

  it('detects tampering and wrong keys', () => {
    const sealed = sealSecret('JBSWY3DPEHPK3PXP', key);
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => openSecret(parts.join('.'), key)).toThrow();
    expect(() =>
      openSecret(sealed, loadSecretBoxKey(randomBytes(32).toString('base64'))),
    ).toThrow();
  });

  it('refuses keys that are not 32 bytes', () => {
    expect(() => loadSecretBoxKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });

  describe('key rotation (ADR-0005)', () => {
    const previous = loadSecretBoxKey(randomBytes(32).toString('base64'));

    /** The format written before key IDs existed. */
    function sealV1(plaintext: string, k: Buffer): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', k, iv);
      const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return ['v1', iv, ct, cipher.getAuthTag()]
        .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
        .join('.');
    }

    it('reads secrets sealed with the previous key while it is configured', () => {
      const old = sealSecret('JBSWY3DPEHPK3PXP', previous);
      expect(openSecret(old, [key, previous])).toBe('JBSWY3DPEHPK3PXP');
      expect(() => openSecret(old, [key])).toThrow(/unknown key/);
    });

    it('reads the old v1 format with either key', () => {
      expect(openSecret(sealV1('JBSWY3DPEHPK3PXP', previous), [key, previous])).toBe(
        'JBSWY3DPEHPK3PXP',
      );
      expect(() => openSecret(sealV1('JBSWY3DPEHPK3PXP', previous), [key])).toThrow();
    });

    it('asks for a re-seal unless the secret is v2 under the current key', () => {
      expect(needsReseal(sealSecret('s', key), key)).toBe(false);
      expect(needsReseal(sealSecret('s', previous), key)).toBe(true);
      expect(needsReseal(sealV1('s', key), key)).toBe(true);
    });
  });
});
