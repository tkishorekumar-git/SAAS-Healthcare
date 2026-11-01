import {
  type ConnectionRoleCheck,
  PrismaClient,
  type ResolvedTenant,
  type TenantTransaction,
  checkConnectionRole,
  resolveTenantByCode,
  withTenant,
} from '@kenisha/database';
import type { TenantId } from '@kenisha/shared';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PRISMA_CLIENT } from './database.constants';

export interface PurgeCounts {
  otp_challenges: number;
  sessions: number;
  platform_sessions: number;
  staff_invitations: number;
  known_devices: number;
}

/**
 * The only database access feature modules receive. Every query runs inside a
 * tenant-bound transaction, so PostgreSQL RLS scopes it to one hospital.
 */
@Injectable()
export class TenantDatabase implements OnModuleDestroy {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  /** `tenantId` must come from the authenticated session, never from request input. */
  run<T>(tenantId: TenantId, work: (tx: TenantTransaction) => Promise<T>): Promise<T> {
    return withTenant(this.prisma, tenantId, work);
  }

  /** Pre-login hospital lookup; reveals only the tenant ID and active flag. */
  resolveTenant(code: string): Promise<ResolvedTenant | null> {
    return resolveTenantByCode(this.prisma, code);
  }

  /**
   * Deletes expired codes, sessions, invitations and devices in every hospital
   * (ADR-0005). PostgreSQL policies limit it to rows already past retention.
   */
  async purgeExpiredAuthData(): Promise<PurgeCounts> {
    const [row] = await this.prisma.$queryRaw<PurgeCounts[]>`
      SELECT * FROM purge_expired_auth_data()`;
    return (
      row ?? {
        otp_challenges: 0,
        sessions: 0,
        platform_sessions: 0,
        staff_invitations: 0,
        known_devices: 0,
      }
    );
  }

  /** Connectivity probe that also confirms the role cannot bypass RLS. */
  checkRole(): Promise<ConnectionRoleCheck> {
    return checkConnectionRole(this.prisma);
  }

  async onModuleDestroy(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
