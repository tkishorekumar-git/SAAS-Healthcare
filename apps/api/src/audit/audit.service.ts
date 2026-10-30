import type { TenantTransaction } from '@kenisha/database';
import { Injectable } from '@nestjs/common';
import type { RequestMeta } from '../auth/auth-context';

export type AuditAction =
  | 'AUTH_OTP_REQUESTED'
  | 'AUTH_OTP_LOGIN'
  | 'AUTH_STAFF_PASSWORD'
  | 'AUTH_STAFF_ACCOUNT_LOCKED'
  | 'AUTH_STAFF_MFA_SENT'
  | 'AUTH_STAFF_LOGIN'
  | 'AUTH_REFRESH_REUSE_DETECTED'
  | 'AUTH_LOGOUT'
  | 'AUTH_LOGOUT_ALL'
  | 'SUPPORT_ACCESS_APPROVED'
  | 'SUPPORT_ACCESS_REJECTED'
  | 'SUPPORT_ACCESS_REVOKED'
  | 'SUPPORT_ACCESS_USED';

export interface AuditEntry {
  action: AuditAction;
  outcome: 'SUCCESS' | 'FAILURE';
  actorUserId?: string | null;
  targetType?: string;
  targetId?: string;
  /** Machine-readable detail only (reason codes, counts). Never PHI, codes or secrets. */
  metadata?: Record<string, string | number | boolean>;
  request?: RequestMeta;
}

/** Writes to the append-only audit_events table inside the caller's tenant transaction. */
@Injectable()
export class AuditService {
  async record(tx: TenantTransaction, tenantId: string, entry: AuditEntry): Promise<void> {
    await tx.auditEvent.create({
      data: {
        tenantId,
        action: entry.action,
        outcome: entry.outcome,
        actorUserId: entry.actorUserId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        ip: entry.request?.ip?.slice(0, 45) ?? null,
        userAgent: entry.request?.userAgent?.slice(0, 300) ?? null,
        ...(entry.metadata ? { metadata: entry.metadata } : {}),
      },
    });
  }
}
