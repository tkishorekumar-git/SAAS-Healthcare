import type { NextConfig } from 'next';
import path from 'node:path';

// Baseline security headers. The Content-Security-Policy is set per request in
// src/middleware.ts; HSTS by the reverse proxy (Caddy) in production.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Self-contained server bundle, only inside the production image build (ADR-0006): it
  // needs symlinks, which Windows development machines may not allow.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // Trace workspace packages from the repository root into the standalone bundle.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  transpilePackages: ['@kenisha/ui'],
  async headers() {
    return [
      { source: '/:path*', headers: securityHeaders },
      // The invitation link carries a one-time token: never send it anywhere as a referrer.
      { source: '/invite', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
    ];
  },
};

export default nextConfig;
