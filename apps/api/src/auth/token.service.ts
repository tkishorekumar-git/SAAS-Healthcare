import { assertTenantId } from '@kenisha/database';
import { type AuthClient, type UserRole, isUserRole } from '@kenisha/shared';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { KeyObject } from 'node:crypto';
import type { Env } from '../config/env.validation';
import type { AuthContext } from './auth-context';
import { InvalidTokenError, loadEd25519Keys, signJwt, verifyJwt } from './crypto/ed25519-jwt';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIENCES: readonly AuthClient[] = ['web', 'mobile'];

/**
 * Issues and verifies 15-minute Ed25519 access tokens. Claims carry IDs and roles only —
 * never names or health data (ADR-0003 §5). Keys are validated at startup.
 */
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

  issueAccessToken(
    context: AuthContext,
    now: Date = new Date(),
  ): { token: string; expiresAt: Date } {
    const iat = Math.floor(now.getTime() / 1000);
    const exp = iat + this.ttlSeconds;
    const token = signJwt(
      {
        iss: this.issuer,
        aud: context.audience,
        sub: context.userId,
        tid: context.tenantId,
        sid: context.sessionId,
        roles: context.roles,
        iat,
        exp,
      },
      this.privateKey,
    );
    return { token, expiresAt: new Date(exp * 1000) };
  }

  /** Throws InvalidTokenError unless the token is authentic, current and well-formed. */
  verifyAccessToken(token: string): AuthContext {
    const claims = verifyJwt(token, this.publicKey, { issuer: this.issuer, audiences: AUDIENCES });
    const { sub, tid, sid, roles, aud } = claims;
    if (
      typeof sub !== 'string' ||
      !UUID.test(sub) ||
      typeof tid !== 'string' ||
      typeof sid !== 'string' ||
      !UUID.test(sid) ||
      !Array.isArray(roles) ||
      !roles.every((role) => isUserRole(role) && role !== 'SUPER_ADMIN')
    ) {
      throw new InvalidTokenError('unexpected claims');
    }
    try {
      assertTenantId(tid);
    } catch {
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
}
