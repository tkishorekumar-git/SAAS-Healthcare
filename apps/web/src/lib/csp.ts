/**
 * Content-Security-Policy for every page (ADR-0006). Scripts run only with this request's
 * nonce ('strict-dynamic' lets Next.js load its own chunks), so injected markup cannot run
 * script. Inline style attributes stay allowed (React `style={{…}}`); they cannot run code.
 */
export interface CspOptions {
  nonce: string;
  /** NEXT_PUBLIC_API_URL: empty means the API is served from this origin (ADR-0006). */
  apiUrl: string;
  development: boolean;
}

export function buildCsp({ nonce, apiUrl, development }: CspOptions): string {
  const connect = ["'self'"];
  if (apiUrl) connect.push(new URL(apiUrl).origin);
  // Next.js development mode needs eval (React Refresh) and a WebSocket for hot reload.
  if (development) connect.push('ws:');

  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
      ...(development ? ["'unsafe-eval'"] : []),
    ],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': connect,
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
    ...(development ? {} : { 'upgrade-insecure-requests': [] }),
  };
  return Object.entries(directives)
    .map(([name, values]) => [name, ...values].join(' '))
    .join('; ');
}

/** 128 random bits, base64. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
