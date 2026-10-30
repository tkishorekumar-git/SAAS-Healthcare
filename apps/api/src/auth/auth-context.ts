import type { AuthClient, TenantId, UserRole } from '@kenisha/shared';

/** The verified identity attached to every authenticated request. */
export interface AuthContext {
  userId: string;
  tenantId: TenantId;
  sessionId: string;
  roles: UserRole[];
  audience: AuthClient;
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
    }
  }
}
