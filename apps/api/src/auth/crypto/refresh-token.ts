import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Refresh token: `rt1.<tenantId>.<sessionId>.<generation>.<secret>` (ADR-0003).
 * Tenant and session IDs are not secret; they let the API open the right RLS context.
 * Only the SHA-256 of the 256-bit secret is stored.
 */
export interface ParsedRefreshToken {
  tenantId: string;
  sessionId: string;
  generation: number;
  secret: string;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const FORMAT = new RegExp(`^rt1\\.(${UUID})\\.(${UUID})\\.(\\d{1,9})\\.([A-Za-z0-9_-]{43})$`);

export function generateRefreshSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function formatRefreshToken(token: ParsedRefreshToken): string {
  return `rt1.${token.tenantId}.${token.sessionId}.${token.generation}.${token.secret}`;
}

export function parseRefreshToken(value: string): ParsedRefreshToken | null {
  const match = FORMAT.exec(value);
  if (!match) {
    return null;
  }
  return {
    tenantId: match[1]!,
    sessionId: match[2]!,
    generation: Number(match[3]),
    secret: match[4]!,
  };
}

/** Platform (Super Admin) refresh token: `pt1.<sessionId>.<generation>.<secret>`. */
export interface ParsedPlatformRefreshToken {
  sessionId: string;
  generation: number;
  secret: string;
}

const PLATFORM_FORMAT = new RegExp(`^pt1\\.(${UUID})\\.(\\d{1,9})\\.([A-Za-z0-9_-]{43})$`);

export function formatPlatformRefreshToken(token: ParsedPlatformRefreshToken): string {
  return `pt1.${token.sessionId}.${token.generation}.${token.secret}`;
}

export function parsePlatformRefreshToken(value: string): ParsedPlatformRefreshToken | null {
  const match = PLATFORM_FORMAT.exec(value);
  if (!match) {
    return null;
  }
  return { sessionId: match[1]!, generation: Number(match[2]), secret: match[3]! };
}

export function refreshSecretMatches(secret: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashRefreshSecret(secret), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}
