import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { PlatformAuthContext, RequestMeta } from '../auth/auth-context';
import {
  formatPlatformRefreshToken,
  generateRefreshSecret,
  hashRefreshSecret,
  parsePlatformRefreshToken,
  refreshSecretMatches,
} from '../auth/crypto/refresh-token';
import { TokenService } from '../auth/token.service';
import { PlatformDatabase } from '../database/platform-database.service';
import { PlatformAuditService } from './platform-audit.service';

/** Super Admin sessions are deliberately shorter than hospital staff sessions. */
const ABSOLUTE_MS = 8 * 3_600_000;
const IDLE_SECS = 15 * 60;

export interface IssuedPlatformSession {
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

const SESSION_EXPIRED = 'Your session has ended. Please log in again.';

/** Same rotation and replay detection as hospital sessions, in platform_sessions. */
@Injectable()
export class PlatformSessionService {
  constructor(
    private readonly db: PlatformDatabase,
    private readonly tokens: TokenService,
    private readonly audit: PlatformAuditService,
  ) {}

  async create(
    platformUserId: string,
    meta: RequestMeta,
    now: Date = new Date(),
  ): Promise<IssuedPlatformSession> {
    const secret = generateRefreshSecret();
    const expiresAt = new Date(now.getTime() + ABSOLUTE_MS);
    const session = await this.db.client.platformSession.create({
      data: {
        platformUserId,
        refreshTokenHash: hashRefreshSecret(secret),
        idleTimeoutSecs: IDLE_SECS,
        lastRefreshedAt: now,
        expiresAt,
        ip: meta.ip?.slice(0, 45) ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
      },
      select: { id: true },
    });
    return this.issue(platformUserId, session.id, 0, secret, expiresAt, now);
  }

  async refresh(
    rawToken: string,
    meta: RequestMeta,
    now: Date = new Date(),
  ): Promise<IssuedPlatformSession> {
    const parsed = parsePlatformRefreshToken(rawToken);
    if (!parsed) {
      throw new UnauthorizedException(SESSION_EXPIRED);
    }

    const result = await this.db.client.$transaction(async (tx) => {
      const session = await tx.platformSession.findUnique({
        where: { id: parsed.sessionId },
        include: { platformUser: { select: { status: true } } },
      });
      if (!session || session.revokedAt) {
        return null;
      }
      if (
        parsed.generation !== session.refreshGeneration ||
        !refreshSecretMatches(parsed.secret, session.refreshTokenHash)
      ) {
        const replayed = parsed.generation < session.refreshGeneration;
        await tx.platformSession.update({
          where: { id: session.id },
          data: { revokedAt: now, revokeReason: replayed ? 'REFRESH_REUSE' : 'REFRESH_MISMATCH' },
        });
        await this.audit.record(
          {
            action: 'PLATFORM_REFRESH_REUSE_DETECTED',
            outcome: 'FAILURE',
            actorPlatformUserId: session.platformUserId,
            targetType: 'platform_session',
            targetId: session.id,
            request: meta,
          },
          tx,
        );
        return null;
      }
      const idleExpired =
        now.getTime() - session.lastRefreshedAt.getTime() > session.idleTimeoutSecs * 1000;
      if (now >= session.expiresAt || idleExpired || session.platformUser.status !== 'ACTIVE') {
        await tx.platformSession.update({
          where: { id: session.id },
          data: { revokedAt: now, revokeReason: 'EXPIRED' },
        });
        return null;
      }

      const secret = generateRefreshSecret();
      const rotated = await tx.platformSession.updateMany({
        where: { id: session.id, refreshGeneration: parsed.generation, revokedAt: null },
        data: {
          refreshGeneration: parsed.generation + 1,
          refreshTokenHash: hashRefreshSecret(secret),
          lastRefreshedAt: now,
        },
      });
      if (rotated.count !== 1) {
        return null;
      }
      return this.issue(
        session.platformUserId,
        session.id,
        parsed.generation + 1,
        secret,
        session.expiresAt,
        now,
      );
    });

    if (!result) {
      throw new UnauthorizedException(SESSION_EXPIRED);
    }
    return result;
  }

  async isActive(auth: PlatformAuthContext, now: Date = new Date()): Promise<boolean> {
    const session = await this.db.client.platformSession.findFirst({
      where: {
        id: auth.sessionId,
        platformUserId: auth.platformUserId,
        revokedAt: null,
        expiresAt: { gt: now },
        platformUser: { status: 'ACTIVE' },
      },
      select: { id: true },
    });
    return session !== null;
  }

  async revoke(
    auth: PlatformAuthContext,
    meta: RequestMeta,
    now: Date = new Date(),
  ): Promise<void> {
    await this.db.client.platformSession.updateMany({
      where: { id: auth.sessionId, revokedAt: null },
      data: { revokedAt: now, revokeReason: 'LOGOUT' },
    });
    await this.audit.record({
      action: 'PLATFORM_LOGOUT',
      outcome: 'SUCCESS',
      actorPlatformUserId: auth.platformUserId,
      targetType: 'platform_session',
      targetId: auth.sessionId,
      request: meta,
    });
  }

  private issue(
    platformUserId: string,
    sessionId: string,
    generation: number,
    secret: string,
    refreshTokenExpiresAt: Date,
    now: Date,
  ): IssuedPlatformSession {
    const access = this.tokens.issuePlatformAccessToken({ platformUserId, sessionId }, now);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: formatPlatformRefreshToken({ sessionId, generation, secret }),
      refreshTokenExpiresAt,
    };
  }
}
