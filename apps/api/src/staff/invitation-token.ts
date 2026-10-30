import { createHash, randomBytes } from 'node:crypto';

/** 256-bit one-time invitation token; only its SHA-256 hash is stored (ADR-0004). */
export function generateInvitationToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashInvitationToken(token) };
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const INVITATION_TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export function invitationLink(webAppUrl: string, hospitalCode: string, token: string): string {
  const url = new URL('/invite', webAppUrl);
  url.searchParams.set('hospital', hospitalCode);
  url.searchParams.set('token', token);
  return url.toString();
}

/** "+919812345678" -> "******5678" for display to the invitee. */
export function maskPhone(phoneE164: string): string {
  return `******${phoneE164.slice(-4)}`;
}
