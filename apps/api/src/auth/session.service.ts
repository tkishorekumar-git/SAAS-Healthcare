import { type TenantTransaction, assertTenantId } from '@kenisha/database';
import type { AuthClient, TenantId, UserRole } from '@kenisha/shared';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { TenantDatabase } from '../database/tenant-database.service';
import type { AuthContext, RequestMeta } from './auth-context';
import {
  formatRefreshToken,
  generateRefreshSecret,
  hashRefreshSecret,
  parseRefreshToken,
  refreshSecretMatches,
} from './crypto/refresh-token';
import { TokenService } from './token.service';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** ADR-0003 §5 lifetimes. */
const LIFETIMES = {
  /** Staff on any client, and patients on web. */
  standard: { slidingMs: 12 * HOUR_MS, absoluteMs: 12 * HOUR_MS, idleSecs: 30 * 60 },
  /** Patients and guardians on the Android app. */
  personalMobile: { slidingMs: 30 * DAY_MS, absoluteMs: 180 * DAY_MS, idleSecs: null },
} as const;

export interface SessionUser {
  id: string;
  accountKind: 'STAFF' | 'PERSONAL';
  roles: UserRole[];
}

export interface IssuedSession {
  client: AuthClient;
  accessToken: string;
  accessTokenExpiresAt: Date;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

const SESSION_EXPIRED = 'Your session has ended. Please log in again.';

@Injectable()
export class SessionService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  /** Creates a session inside an existing tenant transaction (called by login flows). */
  async create(
    tx: TenantTransaction,
    tenantId: TenantId,
    user: SessionUser,
    client: AuthClient,
    meta: RequestMeta,
    now: Date = new Date(),
  ): Promise<IssuedSession> {
    const lifetime = this.lifetimeFor(user.accountKind, client);
    const secret = generateRefreshSecret();
    const expiresAt = new Date(now.getTime() + lifetime.slidingMs);
    const session = await tx.session.create({
      data: {
        tenantId,
        userId: user.id,
        client: client === 'web' ? 'WEB' : 'MOBILE',
        refreshTokenHash: hashRefreshSecret(secret),
        idleTimeoutSecs: lifetime.idleSecs,
        lastRefreshedAt: now,
        expiresAt,
        absoluteExpiresAt: new Date(now.getTime() + lifetime.absoluteMs),
        ip: meta.ip?.slice(0, 45) ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
      },
      select: { id: true },
    });
    return this.issue(tenantId, session.id, 0, secret, user.roles, user.id, client, expiresAt, now);
  }

  /**
   * Exchanges a refresh token for new tokens, rotating the refresh secret. Presenting an
   * already-used token revokes the whole session (likely theft).
   */
  async refresh(
    rawToken: string,
    meta: RequestMeta,
    now: Date = new Date(),
  ): Promise<IssuedSession> {
    const parsed = parseRefreshToken(rawToken);
    if (!parsed) {
      throw new UnauthorizedException(SESSION_EXPIRED);
    }
    assertTenantId(parsed.tenantId);
    const tenantId = parsed.tenantId;

    const result = await this.db.run(tenantId, async (tx) => {
      const session = await tx.session.findUnique({
        where: { id: parsed.sessionId },
        include: {
          user: {
            select: {
              id: true,
              accountKind: true,
              status: true,
              roles: { select: { role: true } },
            },
          },
        },
      });
      if (!session || session.revokedAt) {
        return null;
      }

      const replayed = parsed.generation < session.refreshGeneration;
      if (
        parsed.generation !== session.refreshGeneration ||
        !refreshSecretMatches(parsed.secret, session.refreshTokenHash)
      ) {
        await this.revokeInTx(tx, session.id, replayed ? 'REFRESH_REUSE' : 'REFRESH_MISMATCH', now);
        await this.audit.record(tx, tenantId, {
          action: 'AUTH_REFRESH_REUSE_DETECTED',
          outcome: 'FAILURE',
          actorUserId: session.userId,
          targetType: 'session',
          targetId: session.id,
          metadata: { reason: replayed ? 'REPLAYED_TOKEN' : 'SECRET_MISMATCH' },
          request: meta,
        });
        return null;
      }

      const idleExpired =
        session.idleTimeoutSecs !== null &&
        now.getTime() - session.lastRefreshedAt.getTime() > session.idleTimeoutSecs * 1000;
      if (now >= session.expiresAt || idleExpired) {
        await this.revokeInTx(tx, session.id, 'EXPIRED', now);
        return null;
      }
      if (session.user.status !== 'ACTIVE') {
        await this.revokeInTx(tx, session.id, 'USER_DISABLED', now);
        return null;
      }

      const client: AuthClient = session.client === 'WEB' ? 'web' : 'mobile';
      const lifetime = this.lifetimeFor(session.user.accountKind, client);
      const expiresAt = new Date(
        Math.min(now.getTime() + lifetime.slidingMs, session.absoluteExpiresAt.getTime()),
      );
      const secret = generateRefreshSecret();
      const nextGeneration = session.refreshGeneration + 1;
      const rotated = await tx.session.updateMany({
        // Optimistic lock: a concurrent refresh of the same generation loses.
        where: { id: session.id, refreshGeneration: parsed.generation, revokedAt: null },
        data: {
          refreshGeneration: nextGeneration,
          refreshTokenHash: hashRefreshSecret(secret),
          lastRefreshedAt: now,
          expiresAt,
        },
      });
      if (rotated.count !== 1) {
        return null;
      }

      const roles = session.user.roles.map((r) => r.role as UserRole);
      return this.issue(
        tenantId,
        session.id,
        nextGeneration,
        secret,
        roles,
        session.userId,
        client,
        expiresAt,
        now,
      );
    });

    if (!result) {
      throw new UnauthorizedException(SESSION_EXPIRED);
    }
    return result;
  }

  /** Per-request check: the session still exists, is not revoked or expired, user active. */
  async isActive(auth: AuthContext, now: Date = new Date()): Promise<boolean> {
    const session = await this.db.run(auth.tenantId, (tx) =>
      tx.session.findFirst({
        where: {
          id: auth.sessionId,
          userId: auth.userId,
          revokedAt: null,
          expiresAt: { gt: now },
          user: { status: 'ACTIVE' },
        },
        select: { id: true },
      }),
    );
    return session !== null;
  }

  async revoke(auth: AuthContext, meta: RequestMeta, now: Date = new Date()): Promise<void> {
    await this.db.run(auth.tenantId, async (tx) => {
      await this.revokeInTx(tx, auth.sessionId, 'LOGOUT', now);
      await this.audit.record(tx, auth.tenantId, {
        action: 'AUTH_LOGOUT',
        outcome: 'SUCCESS',
        actorUserId: auth.userId,
        targetType: 'session',
        targetId: auth.sessionId,
        request: meta,
      });
    });
  }

  async revokeAllForUser(
    auth: AuthContext,
    meta: RequestMeta,
    now: Date = new Date(),
  ): Promise<void> {
    await this.db.run(auth.tenantId, async (tx) => {
      const { count } = await tx.session.updateMany({
        where: { userId: auth.userId, revokedAt: null },
        data: { revokedAt: now, revokeReason: 'LOGOUT_ALL' },
      });
      await this.audit.record(tx, auth.tenantId, {
        action: 'AUTH_LOGOUT_ALL',
        outcome: 'SUCCESS',
        actorUserId: auth.userId,
        metadata: { sessionsRevoked: count },
        request: meta,
      });
    });
  }

  private async revokeInTx(
    tx: TenantTransaction,
    sessionId: string,
    reason: string,
    now: Date,
  ): Promise<void> {
    await tx.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: now, revokeReason: reason },
    });
  }

  private lifetimeFor(accountKind: 'STAFF' | 'PERSONAL', client: AuthClient) {
    return accountKind === 'PERSONAL' && client === 'mobile'
      ? LIFETIMES.personalMobile
      : LIFETIMES.standard;
  }

  private issue(
    tenantId: TenantId,
    sessionId: string,
    generation: number,
    secret: string,
    roles: UserRole[],
    userId: string,
    client: AuthClient,
    refreshTokenExpiresAt: Date,
    now: Date,
  ): IssuedSession {
    const access = this.tokens.issueAccessToken(
      { userId, tenantId, sessionId, roles, audience: client },
      now,
    );
    return {
      client,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: formatRefreshToken({ tenantId, sessionId, generation, secret }),
      refreshTokenExpiresAt,
    };
  }
}
