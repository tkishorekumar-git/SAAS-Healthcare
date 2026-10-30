import { ROLE_LABELS, type UserRole } from '@kenisha/shared';

const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const date = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' });

export function formatDateTime(value: string | null | undefined): string {
  return value ? dateTime.format(new Date(value)) : '—';
}

export function formatDate(value: string | null | undefined): string {
  return value ? date.format(new Date(value)) : '—';
}

export function roleList(roles: readonly UserRole[]): string {
  return roles.map((role) => ROLE_LABELS[role]).join(', ');
}

/** "AUTH_STAFF_LOGIN" -> "Auth staff login" for the audit log. */
export function humanize(code: string): string {
  const words = code.toLowerCase().replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const HOSPITAL_CODE_KEY = 'kenisha.hospitalCode';

/** Remembers the last hospital code on this device (a convenience, never required). */
export function rememberedHospitalCode(): string {
  try {
    return localStorage.getItem(HOSPITAL_CODE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberHospitalCode(code: string): void {
  try {
    localStorage.setItem(HOSPITAL_CODE_KEY, code.trim().toLowerCase());
  } catch {
    // Storage may be unavailable (private mode); the form still works.
  }
}
