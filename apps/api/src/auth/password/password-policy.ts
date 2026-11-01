import { readFileSync } from 'node:fs';
import path from 'node:path';

export const PASSWORD_MIN_LENGTH = 12;
/** Upper bound protects the hasher from denial-of-service with huge inputs. */
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Breached and most common passwords (ADR-0005 S4), bundled with the API so no part of a
 * password ever leaves the server. Loaded once, on first use.
 */
export const BREACHED_PASSWORDS_FILE = path.resolve(
  __dirname,
  '../../../data/breached-passwords.txt',
);

let breached: ReadonlySet<string> | undefined;

export function parseBreachedPasswords(text: string): Set<string> {
  const entries = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().toLowerCase();
    if (line && !line.startsWith('#')) entries.add(line);
  }
  return entries;
}

function breachedPasswords(): ReadonlySet<string> {
  breached ??= parseBreachedPasswords(readFileSync(BREACHED_PASSWORDS_FILE, 'utf8'));
  return breached;
}

/** Number of entries in the bundled list (reported at start-up). */
export function breachedPasswordCount(): number {
  return breachedPasswords().size;
}

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
  if (breachedPasswords().has(lower) || FORBIDDEN_FRAGMENTS.some((f) => lower.includes(f))) {
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
