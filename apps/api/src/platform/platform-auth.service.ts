import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PlatformAuthContext, RequestMeta } from '../auth/auth-context';
import { InvalidTokenError } from '../auth/crypto/ed25519-jwt';
import { loadSecretBoxKey, openSecret } from '../auth/crypto/secret-box';
import { verifyTotp } from '../auth/crypto/totp';
import { verifyPassword } from '../auth/password/password-hasher';
import { TokenService } from '../auth/token.service';
import type { Env } from '../config/env.validation';
import { PlatformDatabase } from '../database/platform-database.service';
import { PlatformAuditService } from './platform-audit.service';
import { type IssuedPlatformSession, PlatformSessionService } from './platform-session.service';

const LOCK_AFTER_FAILURES = 5;
const LOCK_BASE_MS = 15 * 60_000;
const LOCK_MAX_MS = 24 * 3_600_000;
const INVALID_LOGIN = 'Invalid login details.';

/**
 * Super Admin login (ADR-0003 section 4, I6): password, then a code from an authenticator
 * app. Password and code failures share one counter, so knowing the password does not
 * allow unlimited guessing of codes.
 */
@Injectable()
export class PlatformAuthService {
  private readonly totpKey: Buffer;

  constructor(
    private readonly db: PlatformDatabase,
    private readonly tokens: TokenService,
    private readonly sessions: PlatformSessionService,
    private readonly audit: PlatformAuditService,
    config: ConfigService<Env, true>,
  ) {
    this.totpKey = loadSecretBoxKey(config.get('PLATFORM_TOTP_KEY', { infer: true }));
  }

  /** Step 1: password. Returns a 5-minute token for step 2; never a session. */
  async login(
    email: string,
    password: string,
    meta: RequestMeta,
    now: Date = new Date(),
  ): Promise<{ mfaToken: string; expiresInSeconds: number }> {
    const user = await this.db.client.platformUser.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    const locked = user !== null && user.lockedUntil !== null && user.lockedUntil > now;
    const passwordOk = await verifyPassword(password, locked ? null : (user?.passwordHash ?? null));

    if (!user || locked || !passwordOk || user.status !== 'ACTIVE') {
      if (user && !locked && !passwordOk) {
        await this.recordFailure(user.id, user.failedAttempts, meta, now);
      }
      await this.audit.record({
        action: 'PLATFORM_LOGIN_PASSWORD',
        outcome: 'FAILURE',
        actorPlatformUserId: user?.id ?? null,
        metadata: {
          reason: !user
            ? 'UNKNOWN_ACCOUNT'
            : locked
              ? 'LOCKED'
              : !passwordOk
                ? 'WRONG_PASSWORD'
                : 'DISABLED',
        },
        request: meta,
      });
      throw new UnauthorizedException(INVALID_LOGIN);
    }

    return { mfaToken: this.tokens.issuePlatformMfaToken(user.id, now), expiresInSeconds: 300 };
  }

  /** Step 2: authenticator code. Each 30-second code is accepted at most once. */
  async verifyCode(
    mfaToken: string,
    code: string,
    meta: RequestMeta,
    now: Date = new Date(),
  ): Promise<IssuedPlatformSession> {
    let platformUserId: string;
    try {
      platformUserId = this.tokens.verifyPlatformMfaToken(mfaToken);
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        throw new UnauthorizedException('Your login has expired. Please start again.');
      }
      throw error;
    }

    const user = await this.db.client.platformUser.findUnique({ where: { id: platformUserId } });
    const locked = user !== null && user.lockedUntil !== null && user.lockedUntil > now;
    if (!user || locked || user.status !== 'ACTIVE') {
      throw new UnauthorizedException(INVALID_LOGIN);
    }

    const lastStep = user.totpLastUsedStep === null ? null : Number(user.totpLastUsedStep);
    const step = verifyTotp(
      openSecret(user.totpSecretEncrypted, this.totpKey),
      code,
      now,
      lastStep,
    );
    if (step === null) {
      await this.recordFailure(user.id, user.failedAttempts, meta, now);
      await this.audit.record({
        action: 'PLATFORM_LOGIN_TOTP',
        outcome: 'FAILURE',
        actorPlatformUserId: user.id,
        metadata: { reason: 'WRONG_OR_REUSED_CODE' },
        request: meta,
      });
      throw new UnauthorizedException('The code is invalid or has already been used.');
    }

    // Optimistic lock: two concurrent logins with the same code cannot both succeed.
    const accepted = await this.db.client.platformUser.updateMany({
      where: {
        id: user.id,
        OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: BigInt(step) } }],
      },
      data: { totpLastUsedStep: BigInt(step), failedAttempts: 0, lockedUntil: null },
    });
    if (accepted.count !== 1) {
      throw new UnauthorizedException('The code is invalid or has already been used.');
    }

    const session = await this.sessions.create(user.id, meta, now);
    await this.audit.record({
      action: 'PLATFORM_LOGIN_TOTP',
      outcome: 'SUCCESS',
      actorPlatformUserId: user.id,
      request: meta,
    });
    return session;
  }

  async me(auth: PlatformAuthContext): Promise<{
    platformUserId: string;
    email: string;
    displayName: string;
    roles: ['SUPER_ADMIN'];
  }> {
    const user = await this.db.client.platformUser.findUniqueOrThrow({
      where: { id: auth.platformUserId },
      select: { id: true, email: true, displayName: true },
    });
    return {
      platformUserId: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: ['SUPER_ADMIN'],
    };
  }

  private async recordFailure(
    platformUserId: string,
    previousFailures: number,
    meta: RequestMeta,
    now: Date,
  ): Promise<void> {
    const failures = previousFailures + 1;
    const lockedUntil =
      failures >= LOCK_AFTER_FAILURES
        ? new Date(
            now.getTime() +
              Math.min(LOCK_BASE_MS * 2 ** (failures - LOCK_AFTER_FAILURES), LOCK_MAX_MS),
          )
        : null;
    await this.db.client.platformUser.update({
      where: { id: platformUserId },
      data: { failedAttempts: failures, lockedUntil },
    });
    if (lockedUntil) {
      await this.audit.record({
        action: 'PLATFORM_ACCOUNT_LOCKED',
        outcome: 'FAILURE',
        actorPlatformUserId: platformUserId,
        metadata: { failedAttempts: failures },
        request: meta,
      });
    }
  }
}
