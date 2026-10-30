import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../auth/auth-context';
import { TenantDatabase } from '../database/tenant-database.service';

export interface SupportAccessRequestView {
  id: string;
  requesterName: string;
  reason: string;
  requestedMinutes: number;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REVOKED';
  /** True only while an approval is in force. */
  active: boolean;
  decidedByUserId: string | null;
  decidedAt: Date | null;
  approvedUntil: Date | null;
  createdAt: Date;
}

/**
 * Hospital side of break-glass (ADR-0003 section 8). Runs as kenisha_app inside the
 * hospital's own tenant context; the database enforces allowed transitions and that an
 * approval never exceeds the requested duration.
 */
@Injectable()
export class SupportAccessService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext, now: Date = new Date()): Promise<SupportAccessRequestView[]> {
    return this.db.run(auth.tenantId, async (tx) => {
      const rows = await tx.supportAccessRequest.findMany({
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return rows.map((row) => toView(row, now));
    });
  }

  approve(auth: AuthContext, id: string, meta: RequestMeta, now: Date = new Date()) {
    return this.decide(auth, id, 'SUPPORT_ACCESS_APPROVED', meta, now, (request) => ({
      status: 'APPROVED' as const,
      decidedByUserId: auth.userId,
      decidedAt: now,
      approvedUntil: new Date(now.getTime() + request.requestedMinutes * 60_000),
    }));
  }

  reject(auth: AuthContext, id: string, meta: RequestMeta, now: Date = new Date()) {
    return this.decide(auth, id, 'SUPPORT_ACCESS_REJECTED', meta, now, () => ({
      status: 'REJECTED' as const,
      decidedByUserId: auth.userId,
      decidedAt: now,
    }));
  }

  /** Ends an approved grant immediately; the database caps approved_until at now(). */
  revoke(auth: AuthContext, id: string, meta: RequestMeta, now: Date = new Date()) {
    return this.decide(auth, id, 'SUPPORT_ACCESS_REVOKED', meta, now, () => ({
      status: 'REVOKED' as const,
    }));
  }

  /**
   * Called by the guard on every break-glass request: true only while the grant is
   * approved, unexpired and belongs to this Super Admin. Each use is audited.
   */
  async useGrant(auth: AuthContext, operation: string, meta: RequestMeta): Promise<boolean> {
    const grant = auth.supportAccess;
    if (!grant) {
      return false;
    }
    return this.db.run(auth.tenantId, async (tx) => {
      const request = await tx.supportAccessRequest.findFirst({
        where: {
          id: grant.requestId,
          requestedById: grant.platformUserId,
          status: 'APPROVED',
          approvedUntil: { gt: new Date() },
        },
        select: { id: true },
      });
      await this.audit.record(tx, auth.tenantId, {
        action: 'SUPPORT_ACCESS_USED',
        outcome: request ? 'SUCCESS' : 'FAILURE',
        targetType: 'support_access_request',
        targetId: grant.requestId,
        // Route template only (e.g. "GET /api/v1/branches") — never query strings or bodies.
        metadata: { operation, platformUserId: grant.platformUserId },
        request: meta,
      });
      return request !== null;
    });
  }

  private async decide(
    auth: AuthContext,
    id: string,
    action: 'SUPPORT_ACCESS_APPROVED' | 'SUPPORT_ACCESS_REJECTED' | 'SUPPORT_ACCESS_REVOKED',
    meta: RequestMeta,
    now: Date,
    change: (request: { requestedMinutes: number }) => {
      status: 'APPROVED' | 'REJECTED' | 'REVOKED';
      decidedByUserId?: string;
      decidedAt?: Date;
      approvedUntil?: Date;
    },
  ): Promise<SupportAccessRequestView> {
    const from = action === 'SUPPORT_ACCESS_REVOKED' ? 'APPROVED' : 'REQUESTED';
    const result = await this.db.run(auth.tenantId, async (tx) => {
      const request = await tx.supportAccessRequest.findFirst({ where: { id, status: from } });
      if (!request) {
        return null;
      }
      const updated = await tx.supportAccessRequest.update({
        where: { id },
        data: change(request),
      });
      await this.audit.record(tx, auth.tenantId, {
        action,
        outcome: 'SUCCESS',
        actorUserId: auth.userId,
        targetType: 'support_access_request',
        targetId: id,
        metadata: {
          platformUserId: request.requestedById,
          requestedMinutes: request.requestedMinutes,
        },
        request: meta,
      });
      return toView(updated, now);
    });
    if (!result) {
      throw new NotFoundException(`No ${from.toLowerCase()} support access request with that ID.`);
    }
    return result;
  }
}

function toView(
  row: {
    id: string;
    requesterName: string;
    reason: string;
    requestedMinutes: number;
    status: SupportAccessRequestView['status'];
    decidedByUserId: string | null;
    decidedAt: Date | null;
    approvedUntil: Date | null;
    createdAt: Date;
  },
  now: Date,
): SupportAccessRequestView {
  return {
    id: row.id,
    requesterName: row.requesterName,
    reason: row.reason,
    requestedMinutes: row.requestedMinutes,
    status: row.status,
    active: row.status === 'APPROVED' && row.approvedUntil !== null && row.approvedUntil > now,
    decidedByUserId: row.decidedByUserId,
    decidedAt: row.decidedAt,
    approvedUntil: row.approvedUntil,
    createdAt: row.createdAt,
  };
}
