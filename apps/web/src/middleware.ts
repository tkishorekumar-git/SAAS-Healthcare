import { type NextRequest, NextResponse } from 'next/server';
import { buildCsp, createNonce } from './lib/csp';

/**
 * Sends a fresh Content-Security-Policy nonce with every page. Next.js reads the policy
 * from the request headers and puts the nonce on its own scripts; the root layout reads
 * `x-nonce`, which also makes every page render per request (a cached page would carry a
 * stale nonce).
 */
export function middleware(request: NextRequest) {
  const nonce = createNonce();
  const csp = buildCsp({
    nonce,
    apiUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
    development: process.env.NODE_ENV === 'development',
  });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only: static files carry no scripts of their own.
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
