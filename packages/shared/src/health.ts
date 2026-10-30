/** Response contract of `GET /api/v1/health`. */
export interface HealthStatus {
  status: 'ok';
  service: string;
  version: string;
  environment: string;
  timestamp: string;
  uptimeSeconds: number;
}

/**
 * `misconfigured` means the dependency answered but is unsafe to use — e.g. the API is
 * connected to PostgreSQL as a role that can bypass Row-Level Security.
 */
export type DependencyState = 'up' | 'down' | 'misconfigured';

/** Response contract of `GET /api/v1/health/ready` (HTTP 503 when status is `error`). */
export interface ReadinessStatus {
  status: 'ok' | 'error';
  checks: {
    /** kenisha_app connection (hospital data). */
    database: DependencyState;
    /** kenisha_platform connection (Super Admin). */
    platformDatabase: DependencyState;
  };
  timestamp: string;
}
