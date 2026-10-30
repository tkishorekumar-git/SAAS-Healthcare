import type { HealthStatus } from '@kenisha/shared';
import { describe, expect, it, vi } from 'vitest';
import { fetchApiHealth } from './api-health';

const health: HealthStatus = {
  status: 'ok',
  service: 'kenisha-api',
  version: '0.1.0',
  environment: 'test',
  timestamp: '2026-10-30T09:00:00.000Z',
  uptimeSeconds: 1,
};

describe('fetchApiHealth', () => {
  it('returns the health payload when the API responds', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(health));

    const result = await fetchApiHealth('http://api.test', fetchMock);

    expect(result).toEqual({ reachable: true, health });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://api.test/api/v1/health');
  });

  it('reports non-2xx responses as unreachable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));

    await expect(fetchApiHealth('http://api.test', fetchMock)).resolves.toEqual({
      reachable: false,
      error: 'HTTP 503',
    });
  });

  it('reports network errors as unreachable', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(fetchApiHealth('http://api.test', fetchMock)).resolves.toEqual({
      reachable: false,
      error: 'ECONNREFUSED',
    });
  });
});
