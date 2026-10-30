import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { PlatformAuthContext, RequestMeta } from '../auth/auth-context';
import { TokenService } from '../auth/token.service';
import { PlatformDatabase } from '../database/platform-database.service';
import { PlatformAuditService } from './platform-audit.service';

/**
 * Platform side of break-glass (ADR-0003 section 8). A Super Admin can file a request
 * and, once the hospital approves it, obtain a short-lived token for that hospital.
 * The platform role has no UPDATE privilege on requests, so it cannot approve itself.
 */
@Injectable()
export class PlatformSupportAccessService {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly tokens: TokenService,
    private readonly audit: PlatformAuditService,
  ) {}

  async request(
    auth: PlatformAuthContext,
    hospitalCode: string,
    reason: string,
    durationMinutes: number,
    meta: RequestMeta,
  ) {
    const tenant = await this.db.client.tenant.findUnique({
      where: { slug: hospitalCode.trim().toLowerCase() },
      select: { id: true },
    });
    if (!tenant) {
      throw new NotFoundException('No hospital with that code.');
    }
    const requester = await this.db.client.platformUser.findUniqueOrThrow({
      where: { id: auth.platformUserId },
      select: { displayName: true },
    });
    const created = await this.db.client.supportAccessRequest.create({
      data: {
        tenantId: tenant.id,
        requestedById: auth.platformUserId,
        requesterName: requester.displayName,
        reason: reason.trim(),
        requestedMinutes: durationMinutes,
      },
    });
    await this.audit.record({
      action: 'SUPPORT_ACCESS_REQUESTED',
      outcome: 'SUCCESS',
      actorPlatformUserId: auth.platformUserId,
      tenantId: tenant.id,
      targetType: 'support_access_request',
      targetId: created.id,
      metadata: { requestedMinutes: durationMinutes },
      request: meta,
    });
    return created;
  }

  list() {
    return this.db.client.supportAccessRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { tenant: { select: { slug: true, name: true } } },
    });
  }

  async issueToken(
    auth: PlatformAuthContext,
    requestId: string,
    meta: RequestMeta,
    now: Date = new Date(),
  ): Promise<{ accessToken: string; accessTokenExpiresAt: Date; tenantId: string }> {
    const request = await this.db.client.supportAccessRequest.findUnique({
      where: { id: requestId },
    });
    const usable =
      request !== null &&
      request.requestedById === auth.platformUserId &&
      request.status === 'APPROVED' &&
      request.approvedUntil !== null &&
      request.approvedUntil > now;

    await this.audit.record({
      action: 'SUPPORT_ACCESS_TOKEN_ISSUED',
      outcome: usable ? 'SUCCESS' : 'FAILURE',
      actorPlatformUserId: auth.platformUserId,
      tenantId: request?.tenantId ?? null,
      targetType: 'support_access_request',
      targetId: requestId,
      request: meta,
    });
    if (!usable) {
      throw new ForbiddenException(
        'Support access has not been approved by the hospital, or it has ended.',
      );
    }

    const token = this.tokens.issueSupportAccessToken(
      auth.platformUserId,
      request.tenantId,
      request.id,
      request.approvedUntil!,
      now,
    );
    return {
      accessToken: token.token,
      accessTokenExpiresAt: token.expiresAt,
      tenantId: request.tenantId,
    };
  }
}
