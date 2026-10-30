import { hashPassword, verifyPassword } from './password-hasher';
import { checkPasswordPolicy } from './password-policy';

describe('checkPasswordPolicy', () => {
  it('accepts a long, uncommon password', () => {
    expect(checkPasswordPolicy('Monsoon-Ledger-47-Banyan')).toEqual([]);
  });

  it.each([
    ['too short', 'Short-1a'],
    ['too common', 'Password@123456'],
    ['too common', 'hospital@123'],
    ['repeated character', 'aaaaaaaaaaaaaaaa'],
  ])('rejects a %s password', (_reason, password) => {
    expect(checkPasswordPolicy(password)).not.toEqual([]);
  });

  it('rejects passwords containing personal details', () => {
    const context = {
      email: 'priya.rao@example.test',
      phoneE164: '+919812345678',
      hospitalCode: 'demo-aarogya',
    };
    expect(checkPasswordPolicy('priya.rao-Banyan-2026', context)).toContain(
      'must not contain your email, phone number or hospital code',
    );
    expect(checkPasswordPolicy('Banyan-9812345678', context)).not.toEqual([]);
    expect(checkPasswordPolicy('Demo-Aarogya-Banyan-7', context)).not.toEqual([]);
  });

  it('rejects over-long passwords', () => {
    expect(checkPasswordPolicy('x'.repeat(129) + 'A1-')).toContain(
      'must be at most 128 characters',
    );
  });
});

describe('password hashing (Argon2id)', () => {
  it('verifies the right password and rejects others', async () => {
    const stored = await hashPassword('Monsoon-Ledger-47-Banyan');
    expect(stored).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword('Monsoon-Ledger-47-Banyan', stored)).resolves.toBe(true);
    await expect(verifyPassword('monsoon-ledger-47-banyan', stored)).resolves.toBe(false);
  });

  it('returns false (after doing equivalent work) when there is no account', async () => {
    await expect(verifyPassword('anything-at-all', null)).resolves.toBe(false);
  });

  it('rejects malformed stored hashes and over-long input without throwing', async () => {
    await expect(verifyPassword('anything-at-all', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword('x'.repeat(10_000), 'not-a-hash')).resolves.toBe(false);
  });
});
