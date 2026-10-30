export const PASSWORD_MIN_LENGTH = 12;
/** Upper bound protects the hasher from denial-of-service with huge inputs. */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * A short list of the most common passwords and patterns. ADR-0003 notes that a full
 * breached-password service is a later enhancement.
 */
const COMMON_PASSWORDS = new Set([
  '123456789012',
  'password1234',
  'password@123',
  'passw0rd1234',
  'qwertyuiop12',
  'qwerty123456',
  'iloveyou1234',
  'welcome@1234',
  'welcome12345',
  'admin@123456',
  'administrator',
  'letmein12345',
  'changeme1234',
  'abc123456789',
  'india@123456',
  'hospital@123',
  'hospital1234',
  'doctor@12345',
  'kenisha@1234',
  'kenisha12345',
]);

const FORBIDDEN_FRAGMENTS = ['password', 'qwerty', 'kenisha', '123456789'];

export interface PasswordContext {
  email?: string | null;
  phoneE164?: string | null;
  hospitalCode?: string | null;
}

/** Returns human-readable problems; an empty array means the password is acceptable. */
export function checkPasswordPolicy(password: string, context: PasswordContext = {}): string[] {
  const problems: string[] = [];
  const lower = password.toLowerCase();

  if (password.length < PASSWORD_MIN_LENGTH) {
    problems.push(`must be at least ${PASSWORD_MIN_LENGTH} characters`);
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    problems.push(`must be at most ${PASSWORD_MAX_LENGTH} characters`);
  }
  if (COMMON_PASSWORDS.has(lower) || FORBIDDEN_FRAGMENTS.some((f) => lower.includes(f))) {
    problems.push('is too common');
  }
  if (/^(.)\1+$/.test(password)) {
    problems.push('must not repeat a single character');
  }

  const personal = [
    context.email?.split('@')[0],
    context.phoneE164?.replace(/^\+/, '').slice(-10),
    context.hospitalCode,
  ].filter((value): value is string => typeof value === 'string' && value.length >= 4);
  if (personal.some((value) => lower.includes(value.toLowerCase()))) {
    problems.push('must not contain your email, phone number or hospital code');
  }

  return problems;
}
