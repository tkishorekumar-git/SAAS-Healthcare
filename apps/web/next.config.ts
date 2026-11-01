import type { NextConfig } from 'next';

// Baseline security headers. HSTS is set by the reverse proxy (Caddy) in production.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
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
