import type { AuthClient, TenantId, UserRole } from '@kenisha/shared';

/** The verified identity attached to every authenticated hospital request. */
export interface AuthContext {
  /** Hospital user ID — or, during break-glass, the Super Admin's platform user ID. */
  userId: string;
  tenantId: TenantId;
  /** Session ID — or, during break-glass, the support access request ID. */
  sessionId: string;
  roles: UserRole[];
  audience: AuthClient;
  /**
   * Present only for break-glass access (ADR-0003 section 8). Permissions are then limited
   * to SUPPORT_ACCESS_PERMISSIONS and every request is written to the hospital's audit log.
   */
  supportAccess?: { requestId: string; platformUserId: string };
}

/** The verified identity attached to every /platform request (Super Admin). */
export interface PlatformAuthContext {
  platformUserId: string;
  sessionId: string;
}

/** Network details recorded with audit events and sessions. */
export interface RequestMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's documented extension point
  namespace Express {
    interface Request {
      auth?: AuthContext;
      platformAuth?: PlatformAuthContext;
    }
  }
}
