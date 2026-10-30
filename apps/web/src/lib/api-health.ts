import type { HealthStatus } from '@kenisha/shared';

export type ApiHealthResult =
  { reachable: true; health: HealthStatus } | { reachable: false; error: string };

const HEALTH_PATH = '/api/v1/health';
const TIMEOUT_MS = 3000;

export async function fetchApiHealth(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiHealthResult> {
  try {
    const response = await fetchImpl(new URL(HEALTH_PATH, baseUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return { reachable: false, error: `HTTP ${response.status}` };
    }
    return { reachable: true, health: (await response.json()) as HealthStatus };
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
