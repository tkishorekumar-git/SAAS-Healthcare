import type { HealthcareModuleKey } from './modules';
import type { Permission } from './permissions';
import type { UserRole } from './roles';

export type AuthClient = 'web' | 'mobile';

/**
 * Issued after a successful login or refresh. `refreshToken` is present only for the
 * mobile client; web receives it as an HttpOnly cookie instead.
 */
export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken?: string;
}

export interface OtpChallengeResponse {
  challengeId: string;
  expiresInSeconds: number;
}

export type StaffLoginResponse =
  | { status: 'MFA_REQUIRED'; challengeId: string; expiresInSeconds: number }
  | { status: 'AUTHENTICATED'; tokens: AuthTokens };

export interface CurrentUser {
  userId: string;
  tenantId: string;
  displayName: string;
  accountKind: 'STAFF' | 'PERSONAL';
  roles: UserRole[];
  permissions: Permission[];
  /** Product modules enabled by the hospital's current plan (ADR-0004, T4). */
  enabledModules: HealthcareModuleKey[];
}
