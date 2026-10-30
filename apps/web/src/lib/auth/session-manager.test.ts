import { describe, expect, it, vi } from 'vitest';
import { ApiError, type apiFetch } from '../api/http';
import { SessionManager } from './session-manager';

const NOW = Date.parse('2026-10-30T10:00:00Z');
const inMinutes = (m: number) => new Date(NOW + m * 60_000).toISOString();

function setup(responses: Record<string, Array<() => unknown>>) {
  const calls: Array<{ path: string; token: string | null | undefined }> = [];
  const fetcher = vi.fn(async (path: string, options: { token?: string | null } = {}) => {
    calls.push({ path, token: options.token });
    const next = responses[path]?.shift();
    if (!next) throw new Error(`unexpected call ${path}`);
    return next();
  }) as unknown as typeof apiFetch;
  const session = new SessionManager('/auth/refresh', 'test-lock', fetcher, () => NOW);
  return { session, calls };
}

describe('SessionManager', () => {
  it('reuses a valid access token without refreshing', async () => {
    const { session, calls } = setup({});
    session.setTokens({ accessToken: 'a1', accessTokenExpiresAt: inMinutes(10) });
    await expect(session.getToken()).resolves.toBe('a1');
    expect(calls).toEqual([]);
  });

  it('refreshes shortly before expiry', async () => {
    const { session } = setup({
      '/auth/refresh': [() => ({ accessToken: 'a2', accessTokenExpiresAt: inMinutes(15) })],
    });
    session.setTokens({ accessToken: 'a1', accessTokenExpiresAt: inMinutes(0.25) });
    await expect(session.getToken()).resolves.toBe('a2');
  });

  it('never runs two refreshes at once (rotation would end the session)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { session, calls } = setup({
      '/auth/refresh': [
        async () => {
          await gate;
          return { accessToken: 'a2', accessTokenExpiresAt: inMinutes(15) };
        },
      ],
    });

    const results = Promise.all([session.getToken(), session.getToken(), session.refresh()]);
    release();
    await expect(results).resolves.toEqual(['a2', 'a2', 'a2']);
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1);
  });

  it('returns null when the refresh cookie is no longer valid', async () => {
    const { session } = setup({
      '/auth/refresh': [
        () => {
          throw new ApiError(401, 'Your session has ended.');
        },
      ],
    });
    await expect(session.getToken()).resolves.toBeNull();
  });

  it('retries a request once after a 401 with a fresh token', async () => {
    const { session, calls } = setup({
      '/branches': [
        () => {
          throw new ApiError(401, 'revoked');
        },
        () => ['MAIN'],
      ],
      '/auth/refresh': [() => ({ accessToken: 'a2', accessTokenExpiresAt: inMinutes(15) })],
    });
    session.setTokens({ accessToken: 'a1', accessTokenExpiresAt: inMinutes(10) });

    await expect(session.request('/branches')).resolves.toEqual(['MAIN']);
    expect(calls.map((c) => `${c.path}:${c.token ?? '-'}`)).toEqual([
      '/branches:a1',
      '/auth/refresh:-',
      '/branches:a2',
    ]);
  });

  it('surfaces non-auth errors unchanged', async () => {
    const { session } = setup({
      '/branches': [
        () => {
          throw new ApiError(409, 'Your plan allows 2 active branch(es).');
        },
      ],
    });
    session.setTokens({ accessToken: 'a1', accessTokenExpiresAt: inMinutes(10) });
    await expect(session.request('/branches')).rejects.toMatchObject({ status: 409 });
  });
});
