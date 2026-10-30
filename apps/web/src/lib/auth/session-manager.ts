import { ApiError, type ApiRequest, apiFetch } from '../api/http';

export interface IssuedTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
}

type Fetcher = typeof apiFetch;

/** Refresh this long before expiry so requests never race the deadline. */
const EXPIRY_MARGIN_MS = 30_000;

/**
 * Holds the access token in memory only (ADR-0004 section 5) and renews it through the
 * HttpOnly refresh cookie.
 *
 * Refresh tokens rotate and a replayed one ends the whole session (ADR-0003), so two
 * refreshes must never overlap: concurrent callers in a tab share one in-flight refresh,
 * and tabs take turns through the Web Locks API where the browser supports it.
 */
export class SessionManager {
  private token: string | null = null;
  private expiresAt = 0;
  private inFlight: Promise<string | null> | null = null;

  constructor(
    private readonly refreshPath: string,
    private readonly lockName: string,
    private readonly fetcher: Fetcher = apiFetch,
    private readonly now: () => number = Date.now,
  ) {}

  setTokens(tokens: IssuedTokens): void {
    this.token = tokens.accessToken;
    this.expiresAt = Date.parse(tokens.accessTokenExpiresAt);
  }

  clear(): void {
    this.token = null;
    this.expiresAt = 0;
  }

  /** A valid access token, refreshing first if needed; null when the session is over. */
  async getToken(): Promise<string | null> {
    if (this.token && this.expiresAt - EXPIRY_MARGIN_MS > this.now()) {
      return this.token;
    }
    return this.refresh();
  }

  /** At most one refresh at a time, whoever asks. */
  refresh(): Promise<string | null> {
    this.inFlight ??= this.withCrossTabLock(() => this.doRefresh()).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Authenticated request; one transparent retry if the access token was just revoked/expired. */
  async request<T>(path: string, options: Omit<ApiRequest, 'token'> = {}): Promise<T> {
    const token = await this.getToken();
    if (!token) {
      throw new ApiError(401, 'Your session has ended. Please sign in again.');
    }
    try {
      return await this.fetcher<T>(path, { ...options, token });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      this.clear();
      const renewed = await this.refresh();
      if (!renewed) throw error;
      return this.fetcher<T>(path, { ...options, token: renewed });
    }
  }

  private async doRefresh(): Promise<string | null> {
    try {
      const tokens = await this.fetcher<IssuedTokens>(this.refreshPath, {
        method: 'POST',
        body: {},
      });
      this.setTokens(tokens);
      return tokens.accessToken;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.clear();
        return null;
      }
      throw error;
    }
  }

  private withCrossTabLock<T>(work: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    // locks.request resolves to the callback's own result; the DOM typings nest the Promise.
    return locks ? (locks.request(this.lockName, work) as Promise<T>) : work();
  }
}

export const staffSession = new SessionManager('/auth/refresh', 'kenisha-staff-refresh');
export const platformSession = new SessionManager(
  '/platform/auth/refresh',
  'kenisha-platform-refresh',
);
