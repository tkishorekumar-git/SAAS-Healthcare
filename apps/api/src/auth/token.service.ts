import { assertTenantId } from '@kenisha/database';
import { type AuthClient, type UserRole, isUserRole } from '@kenisha/shared';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { KeyObject } from 'node:crypto';
import type { Env } from '../config/env.validation';
import type { AuthContext, PlatformAuthContext } from './auth-context';
import { InvalidTokenError, loadEd25519Keys, signJwt, verifyJwt } from './crypto/ed25519-jwt';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every token carries an audience, and each verifier accepts only its own:
 * - `web` / `mobile`: hospital users
 * - `support`: a Super Admin inside one hospital under an approved break-glass grant
 * - `platform`: a Super Admin on /platform endpoints
 * - `platform-mfa`: "password accepted, authenticator code still needed" (5 minutes)
 * So a platform token can never call hospital endpoints, and vice versa.
 */
const TENANT_AUDIENCES = ['web', 'mobile', 'support'] as const;
const MFA_CHALLENGE_TTL_SECONDS = 300;

@Injectable()
export class TokenService {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private readonly issuer: string;
  private readonly ttlSeconds: number;

  constructor(config: ConfigService<Env, true>) {
    const keys = loadEd25519Keys(
      config.get('JWT_PRIVATE_KEY', { infer: true }),
      config.get('JWT_PUBLIC_KEY', { infer: true }),
    );
    this.privateKey = keys.privateKey;
    this.publicKey = keys.publicKey;
    this.issuer = config.get('JWT_ISSUER', { infer: true });
    this.ttlSeconds = config.get('ACCESS_TOKEN_TTL_SECONDS', { infer: true });
  }

  // --- Hospital users and break-glass ---------------------------------------------

  issueAccessToken(
    context: AuthContext,
    now: Date = new Date(),
  ): { token: string; expiresAt: Date } {
    return this.sign(
      {
        aud: context.audience,
        sub: context.userId,
        tid: context.tenantId,
        sid: context.sessionId,
        roles: context.roles,
      },
      now,
    );
  }

  /** Break-glass token: no roles, bound to one approved request, never outlives it. */
  issueSupportAccessToken(
    platformUserId: string,
    tenantId: string,
    requestId: string,
    grantEndsAt: Date,
    now: Date = new Date(),
  ): { token: string; expiresAt: Date } {
    const maxTtl = Math.floor((grantEndsAt.getTime() - now.getTime()) / 1000);
    return this.sign(
      { aud: 'support', sub: platformUserId, tid: tenantId, grant: requestId },
      now,
      Math.min(this.ttlSeconds, maxTtl),
    );
  }

  /** Throws InvalidTokenError unless the token is an authentic, current hospital token. */
  verifyAccessToken(token: string): AuthContext {
    const claims = verifyJwt(token, this.publicKey, {
      issuer: this.issuer,
      audiences: TENANT_AUDIENCES,
    });
    const { sub, tid, aud } = claims;
    if (!isUuid(sub) || typeof tid !== 'string') {
      throw new InvalidTokenError('unexpected claims');
    }
    try {
      assertTenantId(tid);
    } catch {
      throw new InvalidTokenError('unexpected claims');
    }

    if (aud === 'support') {
      if (!isUuid(claims.grant)) {
        throw new InvalidTokenError('unexpected claims');
      }
      return {
        userId: sub,
        tenantId: tid,
        sessionId: claims.grant,
        roles: [],
        audience: 'web',
        supportAccess: { requestId: claims.grant, platformUserId: sub },
      };
    }

    const { sid, roles } = claims;
    if (
      !isUuid(sid) ||
      !Array.isArray(roles) ||
      !roles.every((role) => isUserRole(role) && role !== 'SUPER_ADMIN')
    ) {
      throw new InvalidTokenError('unexpected claims');
    }
    return {
      userId: sub,
      tenantId: tid,
      sessionId: sid,
      roles: roles as UserRole[],
      audience: aud as AuthClient,
    };
  }

  // --- Platform (Super Admin) -------------------------------------------------------

  issuePlatformAccessToken(
    context: PlatformAuthContext,
    now: Date = new Date(),
  ): { token: string; expiresAt: Date } {
    return this.sign(
      {
        aud: 'platform',
        sub: context.platformUserId,
        sid: context.sessionId,
        roles: ['SUPER_ADMIN'],
      },
      now,
    );
  }

  verifyPlatformAccessToken(token: string): PlatformAuthContext {
    const claims = verifyJwt(token, this.publicKey, {
      issuer: this.issuer,
      audiences: ['platform'],
    });
    if (!isUuid(claims.sub) || !isUuid(claims.sid)) {
      throw new InvalidTokenError('unexpected claims');
    }
    return { platformUserId: claims.sub, sessionId: claims.sid };
  }

  issuePlatformMfaToken(platformUserId: string, now: Date = new Date()): string {
    return this.sign({ aud: 'platform-mfa', sub: platformUserId }, now, MFA_CHALLENGE_TTL_SECONDS)
      .token;
  }

  /** Returns the platform user ID the password step was completed for. */
  verifyPlatformMfaToken(token: string): string {
    const claims = verifyJwt(token, this.publicKey, {
      issuer: this.issuer,
      audiences: ['platform-mfa'],
    });
    if (!isUuid(claims.sub)) {
      throw new InvalidTokenError('unexpected claims');
    }
    return claims.sub;
  }

  private sign(
    claims: Record<string, unknown>,
    now: Date,
    ttlSeconds: number = this.ttlSeconds,
  ): { token: string; expiresAt: Date } {
    const iat = Math.floor(now.getTime() / 1000);
    const exp = iat + Math.max(1, ttlSeconds);
    const token = signJwt({ iss: this.issuer, ...claims, iat, exp }, this.privateKey);
    return { token, expiresAt: new Date(exp * 1000) };
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
