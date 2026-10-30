import { describe, expect, it, vi } from 'vitest';
import { ApiError, apiFetch } from './http';

describe('apiFetch', () => {
  it('sends JSON with credentials and the bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    await apiFetch('/branches', { method: 'POST', body: { code: 'MAIN' }, token: 't1' }, fetchMock);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:4000/api/v1/branches');
    expect(init.credentials).toBe('include');
    expect(init.body).toBe('{"code":"MAIN"}');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t1');
  });

  it('turns NestJS validation errors into one readable message', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { message: ['code must be 6 digits', 'client must be web'] },
          { status: 400 },
        ),
      );
    await expect(apiFetch('/auth/otp/verify', {}, fetchMock)).rejects.toMatchObject({
      status: 400,
      message: 'code must be 6 digits client must be web',
    });
  });

  it('uses a friendly message when the server gives none', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 403 }));
    await expect(apiFetch('/staff', {}, fetchMock)).rejects.toMatchObject({
      message: 'You do not have permission to do this.',
    });
  });

  it('reports network failures without leaking internals', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const attempt = apiFetch('/staff', {}, fetchMock);
    await expect(attempt).rejects.toBeInstanceOf(ApiError);
    await expect(attempt).rejects.toMatchObject({ status: 0 });
  });

  it('handles 204 No Content', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiFetch('/auth/logout', { method: 'POST' }, fetchMock)).resolves.toBeUndefined();
  });
});
