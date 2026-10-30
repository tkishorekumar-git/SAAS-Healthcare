import type { TenantTransaction } from '@kenisha/database';
import {
  type AuthClient,
  type CurrentUser,
  HOSPITAL_ADMIN_ROLES,
  type TenantId,
  type UserRole,
  permissionsForRoles,
} from '@kenisha/shared';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import type { Env } from '../config/env.validation';
import { TenantDatabase } from '../database/tenant-database.service';
import type { AuthContext, RequestMeta } from './auth-context';
import { generateOneTimeCode, hashOneTimeCode, oneTimeCodeMatches } from './crypto/one-time-code';
import { verifyPassword } from './password/password-hasher';
import { normalizePhoneE164 } from './phone';
import { type IssuedSession, SessionService } from './session.service';
import { SMS_PROVIDER, type SmsProvider } from './sms/sms.provider';

/** ADR-0003 §2–3 limits. */
export const OTP_TTL_SECONDS = 300;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_MS = 60_000;
const OTP_WINDOW_MS = 10 * 60_000;
const OTP_MAX_PER_WINDOW = 3;
const LOCK_AFTER_FAILURES = 5;
const LOCK_BASE_MS = 15 * 60_000;
const LOCK_MAX_MS = 24 * 3_600_000;

const PERSONAL_ROLES: readonly UserRole[] = ['PATIENT', 'PARENT_GUARDIAN'];

// Deliberately vague: never reveal whether a hospital, account or code exists.
const INVALID_LOGIN = 'Invalid hospital code or login details.';
const INVALID_CODE = 'The code is invalid or has expired. Please request a new code.';

type ChallengeOutcome = { ok: true; userId: string } | { ok: false; reason: string };

export type StaffLoginResult =
  | { status: 'MFA_REQUIRED'; challengeId: string; expiresInSeconds: number }
  | { status: 'AUTHENTICATED'; session: IssuedSession };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly otpSecret: string;

  constructor(
    private readonly db: TenantDatabase,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    config: ConfigService<Env, true>,
  ) {
    this.otpSecret = config.get('OTP_HMAC_SECRET', { infer: true });
  }

  // ---------------------------------------------------------------------------
  // Patients and guardians: hospital code + mobile number + SMS code (ADR-0003 §2)
  // ---------------------------------------------------------------------------

  async requestPersonalCode(
    hospitalCode: string,
    phoneInput: string,
    meta: RequestMeta,
    now: Date = new Date(),
  ): Promise<{ challengeId: string; expiresInSeconds: number }> {
    const phone = this.requirePhone(phoneInput);
    const tenant = await this.db.resolveTenant(hospitalCode);
    if (!tenant?.isActive) {
      // Same response shape as success: hospital codes are not confirmed or denied.
      return { challengeId: randomUUID(), expiresInSeconds: OTP_TTL_SECONDS };
    }

    const result = await this.db.run(tenant.tenantId, async (tx) => {
      if (await this.isRateLimited(tx, phone, 'PERSONAL_LOGIN', now)) {
        return null;
      }
      const user = await tx.user.findFirst({
        where: { accountKind: 'PERSONAL', phoneE164: phone, status: 'ACTIVE' },
        select: { id: true },
      });
      // A challenge is stored even for unknown numbers, so rate limits and responses
      // are identical whether or not the number is registered.
      const challenge = await this.createChallenge(
        tx,
        tenant.tenantId,
        user?.id ?? null,
        'PERSONAL_LOGIN',
        phone,
        meta,
        now,
      );
      await this.audit.record(tx, tenant.tenantId, {
        action: 'AUTH_OTP_REQUESTED',
        outcome: 'SUCCESS',
        actorUserId: user?.id ?? null,
        targetType: 'otp_challenge',
        targetId: challenge.id,
        metadata: { registered: user !== null },
        request: meta,
      });
      return { challengeId: challenge.id, code: user ? challenge.code : null };
    });

    if (!result) {
      throw new HttpException(
        'Too many code requests. Please wait a few minutes and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (result.code) {
      await this.deliver(phone, result.code);
    }
    return { challengeId: result.challengeId, expiresInSeconds: OTP_TTL_SECONDS };
  }

  async verifyPersonalCode(
    hospitalCode: string,
    challengeId: string,
    code: string,
    client: AuthClient,
    meta: RequestMeta,
    now: Date = new Date(),
  ): Promise<IssuedSession> {
    const tenant = await this.db.resolveTenant(hospitalCode);
    if (!tenant?.isActive) {
      throw new UnauthorizedException(INVALID_CODE);
    }
    const tenantId = tenant.tenantId;

    const session = await this.db.run(tenantId, async (tx) => {
      const outcome = await this.consumeChallenge(tx, challengeId, 'PERSONAL_LOGIN', code, now);
      const user = outcome.ok
        ? await tx.user.findFirst({
            where: { id: outcome.userId, accountKind: 'PERSONAL', status: 'ACTIVE' },
            select: { id: true, roles: { select: { role: true } } },
          })
        : null;
      const roles = (user?.roles ?? []).map((r) => r.role as UserRole);
      const valid =
        user !== null && roles.length > 0 && roles.every((r) => PERSONAL_ROLES.includes(r));

      await this.audit.record(tx, tenantId, {
        action: 'AUTH_OTP_LOGIN',
        outcome: valid ? 'SUCCESS' : 'FAILURE',
        actorUserId: user?.id ?? null,
        targetType: 'otp_challenge',
        targetId: challengeId,
        ...(outcome.ok ? {} : { metadata: { reason: outcome.reason } }),
        request: meta,
      });
      if (!valid) {
        return null;
      }
      return this.sessions.create(
        tx,
        tenantId,
        { id: user.id, accountKind: 'PERSONAL', roles },
        client,
        meta,
        now,
      );
    });

    if (!session) {
      throw new UnauthorizedException(INVALID_CODE);
    }
    return session;
  }

  // ---------------------------------------------------------------------------
  // Staff: password, then SMS second factor (ADR-0003 §3, I5)
  // ---------------------------------------------------------------------------

  async staffLogin(
    hospitalCode: string,
    identifier: string,
    password: string,
    client: AuthClient,
    meta: RequestMeta,
    now: Date = new Date(),
  ): Promise<StaffLoginResult> {
    const tenant = await this.db.resolveTenant(hospitalCode);
    const lookup = this.staffLookup(identifier);
    if (!tenant?.isActive || !lookup) {
      await verifyPassword(password, null); // equalise timing
      throw new UnauthorizedException(INVALID_LOGIN);
    }
    const tenantId = tenant.tenantId;

    const result = await this.db.run(tenantId, async (tx) => {
      const user = await tx.user.findFirst({
        where: { accountKind: 'STAFF', ...lookup },
        select: {
          id: true,
          status: true,
          phoneE164: true,
          roles: { select: { role: true } },
          passwordCredential: true,
        },
      });
      const credential = user?.passwordCredential ?? null;
      const locked =
        credential !== null && credential.lockedUntil !== null && credential.lockedUntil > now;
      const passwordOk = await verifyPassword(
        password,
        locked ? null : (credential?.passwordHash ?? null),
      );
      const roles = (user?.roles ?? []).map((r) => r.role as UserRole);
      const isStaff = roles.length > 0 && roles.every((r) => !PERSONAL_ROLES.includes(r));

      let reason: string | null = null;
      if (!user || !credential) reason = 'UNKNOWN_ACCOUNT';
      else if (locked) reason = 'LOCKED';
      else if (!passwordOk) reason = 'WRONG_PASSWORD';
      else if (user.status !== 'ACTIVE') reason = 'DISABLED';
      else if (!isStaff) reason = 'NO_STAFF_ROLE';

      if (reason !== null || !user || !credential) {
        if (reason === 'WRONG_PASSWORD' && credential) {
          await this.recordPasswordFailure(
            tx,
            tenantId,
            credential.userId,
            credential.failedAttempts,
            meta,
            now,
          );
        }
        await this.audit.record(tx, tenantId, {
          action: 'AUTH_STAFF_PASSWORD',
          outcome: 'FAILURE',
          actorUserId: user?.id ?? null,
          metadata: { reason: reason ?? 'UNKNOWN_ACCOUNT' },
          request: meta,
        });
        return null;
      }

      if (credential.failedAttempts > 0 || credential.lockedUntil) {
        await tx.passwordCredential.update({
          where: { userId: credential.userId },
          data: { failedAttempts: 0, lockedUntil: null },
        });
      }

      const settings = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { staffMfaMode: true },
      });
      const mfaRequired =
        roles.some((r) => HOSPITAL_ADMIN_ROLES.includes(r)) ||
        settings.staffMfaMode === 'ALL_STAFF';

      if (mfaRequired) {
        const challenge = await this.createChallenge(
          tx,
          tenantId,
          user.id,
          'STAFF_MFA',
          user.phoneE164,
          meta,
          now,
        );
        await this.audit.record(tx, tenantId, {
          action: 'AUTH_STAFF_MFA_SENT',
          outcome: 'SUCCESS',
          actorUserId: user.id,
          targetType: 'otp_challenge',
          targetId: challenge.id,
          request: meta,
        });
        return {
          mfa: true as const,
          challengeId: challenge.id,
          code: challenge.code,
          phone: user.phoneE164,
        };
      }

      const session = await this.sessions.create(
        tx,
        tenantId,
        { id: user.id, accountKind: 'STAFF', roles },
        client,
        meta,
        now,
      );
      await this.audit.record(tx, tenantId, {
        action: 'AUTH_STAFF_LOGIN',
        outcome: 'SUCCESS',
        actorUserId: user.id,
        metadata: { secondFactor: false },
        request: meta,
      });
      return { mfa: false as const, session };
    });

    if (!result) {
      throw new UnauthorizedException(INVALID_LOGIN);
    }
    if (result.mfa) {
      await this.deliver(result.phone, result.code);
      return {
        status: 'MFA_REQUIRED',
        challengeId: result.challengeId,
        expiresInSeconds: OTP_TTL_SECONDS,
      };
    }
    return { status: 'AUTHENTICATED', session: result.session };
  }

  async verifyStaffCode(
    hospitalCode: string,
    challengeId: string,
    code: string,
    client: AuthClient,
    meta: RequestMeta,
    now: Date = new Date(),
  ): Promise<IssuedSession> {
    const tenant = await this.db.resolveTenant(hospitalCode);
    if (!tenant?.isActive) {
      throw new UnauthorizedException(INVALID_CODE);
    }
    const tenantId = tenant.tenantId;

    const session = await this.db.run(tenantId, async (tx) => {
      const outcome = await this.consumeChallenge(tx, challengeId, 'STAFF_MFA', code, now);
      const user = outcome.ok
        ? await tx.user.findFirst({
            where: { id: outcome.userId, accountKind: 'STAFF', status: 'ACTIVE' },
            select: { id: true, roles: { select: { role: true } } },
          })
        : null;
      const roles = (user?.roles ?? []).map((r) => r.role as UserRole);
      const valid =
        user !== null && roles.length > 0 && roles.every((r) => !PERSONAL_ROLES.includes(r));

      await this.audit.record(tx, tenantId, {
        action: 'AUTH_STAFF_LOGIN',
        outcome: valid ? 'SUCCESS' : 'FAILURE',
        actorUserId: user?.id ?? null,
        targetType: 'otp_challenge',
        targetId: challengeId,
        metadata: outcome.ok
          ? { secondFactor: true }
          : { secondFactor: true, reason: outcome.reason },
        request: meta,
      });
      if (!valid) {
        return null;
      }
      return this.sessions.create(
        tx,
        tenantId,
        { id: user.id, accountKind: 'STAFF', roles },
        client,
        meta,
        now,
      );
    });

    if (!session) {
      throw new UnauthorizedException(INVALID_CODE);
    }
    return session;
  }

  // ---------------------------------------------------------------------------

  async currentUser(auth: AuthContext): Promise<CurrentUser> {
    const user = await this.db.run(auth.tenantId, (tx) =>
      tx.user.findUniqueOrThrow({
        where: { id: auth.userId },
        select: {
          id: true,
          displayName: true,
          accountKind: true,
          roles: { select: { role: true } },
        },
      }),
    );
    const roles = user.roles.map((r) => r.role as UserRole);
    return {
      userId: user.id,
      tenantId: auth.tenantId,
      displayName: user.displayName,
      accountKind: user.accountKind,
      roles,
      permissions: [...permissionsForRoles(roles)].sort(),
    };
  }

  private requirePhone(input: string): string {
    const phone = normalizePhoneE164(input);
    if (!phone) {
      throw new BadRequestException(
        'Enter the mobile number in international format, for example +919876543210.',
      );
    }
    return phone;
  }

  private staffLookup(identifier: string): { email: string } | { phoneE164: string } | null {
    const value = identifier.trim();
    if (value.includes('@')) {
      return value.length <= 254 ? { email: value.toLowerCase() } : null;
    }
    const phone = normalizePhoneE164(value);
    return phone ? { phoneE164: phone } : null;
  }

  private async isRateLimited(
    tx: TenantTransaction,
    phone: string,
    purpose: 'PERSONAL_LOGIN' | 'STAFF_MFA',
    now: Date,
  ): Promise<boolean> {
    const recent = await tx.otpChallenge.findMany({
      where: {
        phoneE164: phone,
        purpose,
        createdAt: { gt: new Date(now.getTime() - OTP_WINDOW_MS) },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
      take: OTP_MAX_PER_WINDOW,
    });
    const latest = recent[0];
    return (
      recent.length >= OTP_MAX_PER_WINDOW ||
      (latest !== undefined && now.getTime() - latest.createdAt.getTime() < OTP_RESEND_COOLDOWN_MS)
    );
  }

  private async createChallenge(
    tx: TenantTransaction,
    tenantId: TenantId,
    userId: string | null,
    purpose: 'PERSONAL_LOGIN' | 'STAFF_MFA',
    phone: string,
    meta: RequestMeta,
    now: Date,
  ): Promise<{ id: string; code: string }> {
    const id = randomUUID();
    const code = generateOneTimeCode();
    await tx.otpChallenge.create({
      data: {
        id,
        tenantId,
        userId,
        purpose,
        phoneE164: phone,
        codeHmac: hashOneTimeCode(this.otpSecret, id, code),
        maxAttempts: OTP_MAX_ATTEMPTS,
        expiresAt: new Date(now.getTime() + OTP_TTL_SECONDS * 1000),
        requestIp: meta.ip?.slice(0, 45) ?? null,
        createdAt: now,
      },
    });
    return { id, code };
  }

  /** Single-use, attempt-limited, time-limited code check. */
  private async consumeChallenge(
    tx: TenantTransaction,
    challengeId: string,
    purpose: 'PERSONAL_LOGIN' | 'STAFF_MFA',
    code: string,
    now: Date,
  ): Promise<ChallengeOutcome> {
    const challenge = await tx.otpChallenge.findFirst({ where: { id: challengeId, purpose } });
    if (!challenge) return { ok: false, reason: 'UNKNOWN_CHALLENGE' };
    if (challenge.consumedAt) return { ok: false, reason: 'ALREADY_USED' };
    if (challenge.expiresAt <= now) return { ok: false, reason: 'EXPIRED' };
    if (challenge.attempts >= challenge.maxAttempts)
      return { ok: false, reason: 'TOO_MANY_ATTEMPTS' };

    const matches =
      challenge.userId !== null &&
      oneTimeCodeMatches(this.otpSecret, challenge.id, code, challenge.codeHmac);
    if (!matches) {
      await tx.otpChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null, attempts: { lt: challenge.maxAttempts } },
        data: { attempts: { increment: 1 } },
      });
      return { ok: false, reason: 'WRONG_CODE' };
    }

    const consumed = await tx.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1 || challenge.userId === null) {
      return { ok: false, reason: 'ALREADY_USED' };
    }
    return { ok: true, userId: challenge.userId };
  }

  private async recordPasswordFailure(
    tx: TenantTransaction,
    tenantId: TenantId,
    userId: string,
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
    await tx.passwordCredential.update({
      where: { userId },
      data: { failedAttempts: failures, lockedUntil },
    });
    if (lockedUntil) {
      await this.audit.record(tx, tenantId, {
        action: 'AUTH_STAFF_ACCOUNT_LOCKED',
        outcome: 'FAILURE',
        actorUserId: userId,
        metadata: {
          failedAttempts: failures,
          lockedMinutes: Math.round((lockedUntil.getTime() - now.getTime()) / 60_000),
        },
        request: meta,
      });
    }
  }

  /** Sends after the transaction commits. Failures are logged without the phone number. */
  private async deliver(phone: string, code: string): Promise<void> {
    try {
      await this.sms.sendOneTimeCode(phone, code);
    } catch (error) {
      this.logger.error(
        `SMS delivery failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
