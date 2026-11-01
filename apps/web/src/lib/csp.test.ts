import { describe, expect, it } from 'vitest';
import { buildCsp, createNonce } from './csp';

function directives(csp: string): Record<string, string[]> {
  return Object.fromEntries(
    csp.split('; ').map((part) => {
      const [name, ...values] = part.split(' ');
      return [name!, values];
    }),
  );
}

describe('buildCsp', () => {
  it('allows scripts only with the nonce in production', () => {
    const csp = directives(buildCsp({ nonce: 'abc', apiUrl: '', development: false }));
    expect(csp['script-src']).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"]);
    expect(csp['script-src']).not.toContain("'unsafe-inline'");
    expect(csp['script-src']).not.toContain("'unsafe-eval'");
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['upgrade-insecure-requests']).toEqual([]);
  });

  it('keeps API calls on this origin when the API is same-origin', () => {
    const csp = directives(buildCsp({ nonce: 'n', apiUrl: '', development: false }));
    expect(csp['connect-src']).toEqual(["'self'"]);
  });

  it('allows only the configured API origin, never a path or wildcard', () => {
    const csp = directives(
      buildCsp({ nonce: 'n', apiUrl: 'https://api.example.test/api', development: false }),
    );
    expect(csp['connect-src']).toEqual(["'self'", 'https://api.example.test']);
  });

  it('relaxes only what Next.js development mode needs', () => {
    const csp = directives(
      buildCsp({ nonce: 'n', apiUrl: 'http://localhost:4000', development: true }),
    );
    expect(csp['script-src']).toContain("'unsafe-eval'");
    expect(csp['connect-src']).toContain('ws:');
    expect(csp['upgrade-insecure-requests']).toBeUndefined();
  });
});

describe('createNonce', () => {
  it('is random and at least 128 bits', () => {
    const a = createNonce();
    expect(a).not.toBe(createNonce());
    expect(atob(a)).toHaveLength(16);
  });
});
