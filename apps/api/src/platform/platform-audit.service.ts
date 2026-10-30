import type { Prisma } from '@kenisha/database';
import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../auth/auth-context';
import { PlatformDatabase } from '../database/platform-database.service';

export type PlatformAuditAction =
  | 'PLATFORM_LOGIN_PASSWORD'
  | 'PLATFORM_LOGIN_TOTP'
  | 'PLATFORM_ACCOUNT_LOCKED'
  | 'PLATFORM_LOGOUT'
  | 'PLATFORM_REFRESH_REUSE_DETECTED'
  | 'SUPPORT_ACCESS_REQUESTED'
  | 'SUPPORT_ACCESS_TOKEN_ISSUED'
  | 'TENANT_ONBOARDED'
  | 'ADMIN_INVITATION_CREATED'
  | 'TENANT_PLAN_CHANGED'
  | 'TENANT_SUSPENDED'
  | 'TENANT_REACTIVATED';

export interface PlatformAuditEntry {
  action: PlatformAuditAction;
  outcome: 'SUCCESS' | 'FAILURE';
  actorPlatformUserId?: string | null;
  tenantId?: string | null;
  targetType?: string;
  targetId?: string;
  /** Reason codes and IDs only — never passwords, codes, secrets or tokens. */
  metadata?: Record<string, string | number | boolean>;
  request?: RequestMeta;
}

/** Append-only audit of Super Admin actions (platform_audit_events). */
@Injectable()
export class PlatformAuditService {
  constructor(private readonly db: PlatformDatabase) {}

  async record(entry: PlatformAuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    await (tx ?? this.db.client).platformAuditEvent.create({
      data: {
        action: entry.action,
        outcome: entry.outcome,
        actorPlatformUserId: entry.actorPlatformUserId ?? null,
        tenantId: entry.tenantId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ip: entry.request?.ip?.slice(0, 45) ?? null,
        userAgent: entry.request?.userAgent?.slice(0, 300) ?? null,
        ...(entry.metadata ? { metadata: entry.metadata } : {}),
      },
    });
  }
}
