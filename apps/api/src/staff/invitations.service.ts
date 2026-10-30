import type { TenantTransaction } from '@kenisha/database';
import { STAFF_ROLES, type StaffRole } from '@kenisha/shared';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../auth/auth-context';
import { hashPassword } from '../auth/password/password-hasher';
import { checkPasswordPolicy } from '../auth/password/password-policy';
import { normalizePhoneE164 } from '../auth/phone';
import { SMS_PROVIDER, type SmsProvider } from '../auth/sms/sms.provider';
import type { Env } from '../config/env.validation';
import { TenantDatabase } from '../database/tenant-database.service';
import { PlanLimitsService } from '../tenancy/plan-limits.service';
import {
  INVITATION_TOKEN_FORMAT,
  generateInvitationToken,
  hashInvitationToken,
  invitationLink,
  maskPhone,
} from './invitation-token';

export const INVITATION_TTL_MS = 72 * 3_600_000;
const INVALID_INVITATION =
  'This invitation link is invalid or has expired. Ask your administrator for a new one.';

export interface InviteStaffInput {
  displayName: string;
  phone: string;
  email?: string | undefined;
  roles: StaffRole[];
  branchIds: string[];
}

export interface InvitationView {
  id: string;
  displayName: string;
  phoneE164: string;
  email: string | null;
  roles: StaffRole[];
  branchIds: string[];
  status: 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'REVOKED';
  expiresAt: Date;
  invitedBy: 'HOSPITAL' | 'KENISHA';
  acceptedUserId: string | null;
  createdAt: Date;
}

type InvitationRow = {
  id: string;
  displayName: string;
  phoneE164: string;
  email: string | null;
  roles: string[];
  branchIds: string[];
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED';
  expiresAt: Date;
  invitedByPlatformUserId: string | null;
  acceptedUserId: string | null;
  createdAt: Date;
};

/** Staff invitations (ADR-0004 section 1): admins never know anyone's password. */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);
  private readonly webAppUrl: string;

  constructor(
    private readonly db: TenantDatabase,
    private readonly limits: PlanLimitsService,
    private readonly audit: AuditService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    config: ConfigService<Env, true>,
  ) {
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true });
  }

  async invite(
    auth: AuthContext,
    input: InviteStaffInput,
    meta: RequestMeta,
    now: Date = new Date(),
  ): Promise<InvitationView> {
    const phone = normalizePhoneE164(input.phone);
    if (!phone) {
      throw new BadRequestException(
        'Enter the mobile number in international format, e.g. +919876543210.',
      );
    }
    const roles = normalizeRoles(input.roles);
    const email = input.email?.trim().toLowerCase() || null;
    const branchIds = [...new Set(input.branchIds)];
    const { token, hash } = generateInvitationToken();

    const result = await this.db.run(auth.tenantId, async (tx) => {
      await this.limits.assertCanAddStaff(tx, auth.tenantId, now);
      await this.assertActiveBranches(tx, branchIds);
      await this.assertNoConflict(tx, phone, email, now);

      const invitation = await tx.staffInvitation.create({
        data: {
          tenantId: auth.tenantId,
          displayName: input.displayName.trim(),
          phoneE164: phone,
          email,
          roles,
          branchIds,
          tokenHash: hash,
          expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
          invitedByUserId: auth.userId,
        },
      });
      await this.audit.record(tx, auth.tenantId, {
        action: 'STAFF_INVITED',
        outcome: 'SUCCESS',
        actorUserId: auth.userId,
        targetType: 'staff_invitation',
        targetId: invitation.id,
        metadata: { roles: roles.join(','), branches: branchIds.length },
        request: meta,
      });
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        select: { slug: true, name: true },
      });
      return { invitation, tenant };
    });

    await this.send(phone, result.tenant, token);
    return toView(result.invitation, now);
  }

  list(auth: AuthContext, now: Date = new Date()): Promise<InvitationView[]> {
    return this.db.run(auth.tenantId, async (tx) => {
      const rows = await tx.staffInvitation.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
      return rows.map((row) => toView(row, now));
    });
  }

  /** New token and a fresh 72 hours; the previous link stops working. */
  async resend(
    auth: AuthContext,
    id: string,
    meta: RequestMeta,
    now: Date = new Date(),
  ): Promise<InvitationView> {
    const { token, hash } = generateInvitationToken();
    const result = await this.db.run(auth.tenantId, async (tx) => {
      const existing = await tx.staffInvitation.findFirst({ where: { id, status: 'PENDING' } });
      if (!existing) {
        throw new NotFoundException('No pending invitation with that ID.');
      }
      if (existing.expiresAt <= now) {
        // An expired invitation no longer holds a staff slot; re-check the plan.
        await this.limits.assertCanAddStaff(tx, auth.tenantId, now);
      }
      const invitation = await tx.staffInvitation.update({
        where: { id },
        data: { tokenHash: hash, expiresAt: new Date(now.getTime() + INVITATION_TTL_MS) },
      });
      await this.audit.record(tx, auth.tenantId, {
        action: 'STAFF_INVITATION_RESENT',
        outcome: 'SUCCESS',
        actorUserId: auth.userId,
        targetType: 'staff_invitation',
        targetId: id,
        request: meta,
      });
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        select: { slug: true, name: true },
      });
      return { invitation, tenant };
    });
    await this.send(result.invitation.phoneE164, result.tenant, token);
    return toView(result.invitation, now);
  }

  async revoke(
    auth: AuthContext,
    id: string,
    meta: RequestMeta,
    now: Date = new Date(),
  ): Promise<InvitationView> {
    return this.db.run(auth.tenantId, async (tx) => {
      const existing = await tx.staffInvitation.findFirst({ where: { id, status: 'PENDING' } });
      if (!existing) {
        throw new NotFoundException('No pending invitation with that ID.');
      }
      const invitation = await tx.staffInvitation.update({
        where: { id },
        data: { status: 'REVOKED' },
      });
      await this.audit.record(tx, auth.tenantId, {
        action: 'STAFF_INVITATION_REVOKED',
        outcome: 'SUCCESS',
        actorUserId: auth.userId,
        targetType: 'staff_invitation',
        targetId: id,
        request: meta,
      });
      return toView(invitation, now);
    });
  }

  /** Public: what the invitee sees before choosing a password (phone masked). */
  async inspect(hospitalCode: string, token: string, now: Date = new Date()) {
    const { tenantId } = await this.resolveInvitationTenant(hospitalCode, token);
    const view = await this.db.run(tenantId, async (tx) => {
      const invitation = await this.findUsable(tx, token, now);
      if (!invitation) return null;
      const tenant = await tx.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { name: true },
      });
      return {
        hospitalName: tenant.name,
        displayName: invitation.displayName,
        roles: invitation.roles as StaffRole[],
        phone: maskPhone(invitation.phoneE164),
        expiresAt: invitation.expiresAt,
      };
    });
    if (!view) {
      throw new NotFoundException(INVALID_INVITATION);
    }
    return view;
  }

  /**
   * Public: creates the staff account from the invitation in one transaction - user, roles,
   * password, branch assignments - and activates an onboarding hospital on its first admin.
   */
  async accept(
    hospitalCode: string,
    token: string,
    password: string,
    meta: RequestMeta,
    now: Date = new Date(),
  ): Promise<{ hospitalCode: string; displayName: string }> {
    const { tenantId, code } = await this.resolveInvitationTenant(hospitalCode, token);

    // Validate and hash outside the transaction (hashing is deliberately slow).
    const preview = await this.db.run(tenantId, (tx) => this.findUsable(tx, token, now));
    if (!preview) {
      throw new NotFoundException(INVALID_INVITATION);
    }
    const problems = checkPasswordPolicy(password, {
      email: preview.email,
      phoneE164: preview.phoneE164,
      hospitalCode: code,
    });
    if (problems.length > 0) {
      throw new BadRequestException(`Password ${problems.join('; ')}.`);
    }
    const passwordHash = await hashPassword(password);

    return this.db.run(tenantId, async (tx) => {
      const invitation = await this.findUsable(tx, token, now);
      if (!invitation) {
        throw new NotFoundException(INVALID_INVITATION);
      }
      await this.assertNoAccount(tx, invitation.phoneE164, invitation.email);

      const user = await tx.user.create({
        data: {
          tenantId,
          accountKind: 'STAFF',
          displayName: invitation.displayName,
          phoneE164: invitation.phoneE164,
          email: invitation.email,
          roles: { create: invitation.roles.map((role) => ({ role })) },
        },
      });
      await tx.passwordCredential.create({ data: { tenantId, userId: user.id, passwordHash } });

      const branches = await tx.branch.findMany({
        where: { id: { in: invitation.branchIds }, isActive: true },
        select: { id: true },
      });
      if (branches.length > 0) {
        await tx.staffBranchAssignment.createMany({
          data: branches.map((branch) => ({ tenantId, userId: user.id, branchId: branch.id })),
        });
      }

      const accepted = await tx.staffInvitation.updateMany({
        where: { id: invitation.id, status: 'PENDING' },
        data: { status: 'ACCEPTED', acceptedUserId: user.id, acceptedAt: now },
      });
      if (accepted.count !== 1) {
        throw new NotFoundException(INVALID_INVITATION); // lost a race: roll everything back
      }
      // Other pending invitations to the same number are now moot.
      await tx.staffInvitation.updateMany({
        where: { phoneE164: invitation.phoneE164, status: 'PENDING', id: { not: invitation.id } },
        data: { status: 'REVOKED' },
      });

      let activated = false;
      if (invitation.roles.includes('HOSPITAL_ADMIN')) {
        const rows = await tx.$queryRaw<
          Array<{ ok: boolean }>
        >`SELECT activate_onboarding_tenant() AS ok`;
        activated = rows[0]?.ok === true;
      }
      await this.audit.record(tx, tenantId, {
        action: 'STAFF_INVITATION_ACCEPTED',
        outcome: 'SUCCESS',
        actorUserId: user.id,
        targetType: 'staff_invitation',
        targetId: invitation.id,
        metadata: { hospitalActivated: activated, branches: branches.length },
        request: meta,
      });
      return { hospitalCode: code, displayName: user.displayName };
    });
  }

  private async resolveInvitationTenant(hospitalCode: string, token: string) {
    if (!INVITATION_TOKEN_FORMAT.test(token)) {
      throw new NotFoundException(INVALID_INVITATION);
    }
    const tenant = await this.db.resolveTenant(hospitalCode);
    if (!tenant || tenant.status === 'SUSPENDED') {
      throw new NotFoundException(INVALID_INVITATION);
    }
    return { tenantId: tenant.tenantId, code: hospitalCode.trim().toLowerCase() };
  }

  private findUsable(tx: TenantTransaction, token: string, now: Date) {
    return tx.staffInvitation.findFirst({
      where: { tokenHash: hashInvitationToken(token), status: 'PENDING', expiresAt: { gt: now } },
    });
  }

  private async assertActiveBranches(tx: TenantTransaction, branchIds: string[]): Promise<void> {
    if (branchIds.length === 0) return;
    const found = await tx.branch.count({ where: { id: { in: branchIds }, isActive: true } });
    if (found !== branchIds.length) {
      throw new BadRequestException('One or more branches do not exist or are inactive.');
    }
  }

  private async assertNoConflict(
    tx: TenantTransaction,
    phone: string,
    email: string | null,
    now: Date,
  ) {
    await this.assertNoAccount(tx, phone, email);
    const pending = await tx.staffInvitation.findFirst({
      where: { phoneE164: phone, status: 'PENDING', expiresAt: { gt: now } },
      select: { id: true },
    });
    if (pending) {
      throw new ConflictException(
        'This mobile number already has a pending invitation. Resend it instead.',
      );
    }
  }

  private async assertNoAccount(tx: TenantTransaction, phone: string, email: string | null) {
    const existing = await tx.user.findFirst({
      where: { accountKind: 'STAFF', OR: [{ phoneE164: phone }, ...(email ? [{ email }] : [])] },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'A staff account with this mobile number or email already exists.',
      );
    }
  }

  private async send(phone: string, tenant: { slug: string; name: string }, token: string) {
    try {
      await this.sms.sendInvitation(
        phone,
        tenant.name,
        invitationLink(this.webAppUrl, tenant.slug, token),
      );
    } catch (error) {
      this.logger.error(
        `Invitation SMS failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}

export function normalizeRoles(roles: readonly string[]): StaffRole[] {
  const unique = [...new Set(roles)];
  if (
    unique.length === 0 ||
    !unique.every((role) => (STAFF_ROLES as readonly string[]).includes(role))
  ) {
    throw new BadRequestException(`roles must be one or more of: ${STAFF_ROLES.join(', ')}.`);
  }
  return unique as StaffRole[];
}

export function toView(row: InvitationRow, now: Date): InvitationView {
  return {
    id: row.id,
    displayName: row.displayName,
    phoneE164: row.phoneE164,
    email: row.email,
    roles: row.roles as StaffRole[],
    branchIds: row.branchIds ?? [],
    status: row.status === 'PENDING' && row.expiresAt <= now ? 'EXPIRED' : row.status,
    expiresAt: row.expiresAt,
    invitedBy: row.invitedByPlatformUserId ? 'KENISHA' : 'HOSPITAL',
    acceptedUserId: row.acceptedUserId,
    createdAt: row.createdAt,
  };
}
