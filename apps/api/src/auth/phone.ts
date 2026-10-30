const E164 = /^\+[1-9]\d{6,14}$/;

/** Accepts "+91 98765-43210" style input; returns strict E.164 or null. */
export function normalizePhoneE164(input: string): string | null {
  const compact = input.trim().replace(/[\s()-]/g, '');
  return E164.test(compact) ? compact : null;
}
