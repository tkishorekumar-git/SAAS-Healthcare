/** Browser-side API access. Only public configuration lives here (NEXT_PUBLIC_*). */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

const FALLBACK_MESSAGES: Record<number, string> = {
  401: 'Your session has ended. Please sign in again.',
  403: 'You do not have permission to do this.',
  404: 'Not found.',
  429: 'Too many attempts. Please wait a minute and try again.',
};

/**
 * Calls `/api/v1{path}`. Cookies are always included so the API can read the HttpOnly
 * refresh cookie on /auth/refresh; access tokens are passed explicitly, never stored.
 */
export async function apiFetch<T>(
  path: string,
  { method = 'GET', body, token, signal }: ApiRequest = {},
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetchImpl(`${API_URL}/api/v1${path}`, {
      method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
      credentials: 'include',
      ...(signal ? { signal } : {}),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the Kenisha server. Check your connection and try again.');
  }

  const text = response.status === 204 ? '' : await response.text();
  const data: unknown = text ? safeJson(text) : undefined;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      messageFrom(data) ??
        FALLBACK_MESSAGES[response.status] ??
        'Something went wrong. Please try again.',
    );
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** NestJS errors carry `message` as a string or (validation) a list of strings. */
function messageFrom(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('message' in data)) return null;
  const message = (data as { message: unknown }).message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.filter((m) => typeof m === 'string').join(' ');
  return null;
}
