import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PlatformAuthContext, RequestMeta } from '../auth/auth-context';
import { normalizePhoneE164 } from '../auth/phone';
import { SMS_PROVIDER, type SmsProvider } from '../auth/sms/sms.provider';
import type { Env } from '../config/env.validation';
import { PlatformDatabase } from '../database/platform-database.service';
import { generateInvitationToken, invitationLink } from '../staff/invitation-token';
import { INVITATION_TTL_MS } from '../staff/invitations.service';
import { PlatformAuditService } from './platform-audit.service';

export interface OnboardHospitalInput {
  code: string;
  name: string;
  planCode: string;
  adminName: string;
  adminPhone: string;
  adminEmail?: string | undefined;
}

interface UsageRow {
  tenant_id: string;
  active_branches: number;
  active_staff: number;
  pending_invitations: number;
}

const SUBSCRIPTION_YEAR_MS = 365 * 86_400_000;

/**
 * Super Admin hospital administration (ADR-0004 section 3). Uses only kenisha_platform:
 * hospital staff data is never visible here - usage comes back as counts only, and the
 * first admin is invited through the one narrow grant on staff_invitations.
 */
@Injectable()
export class PlatformTenantsService {
  private readonly logger = new Logger(PlatformTenantsService.name);
  private readonly webAppUrl: string;

  constructor(
    private readonly db: PlatformDatabase,
    private readonly audit: PlatformAuditService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    config: ConfigService<Env, true>,
  ) {
    this.webAppUrl = config.get('WEB_APP_URL', { infer: true });
  }

  async onboard(
    auth: PlatformAuthContext,
    input: OnboardHospitalInput,
    meta: RequestMeta,
    now: Date = new Date(),
  ) {
    const code = input.code.trim().toLowerCase();
    const phone = normalizePhoneE164(input.adminPhone);
    if (!phone) {
      throw new BadRequestException(
        'adminPhone must be an international number, e.g. +919876543210.',
      );
    }
    const plan = await this.db.client.subscriptionPlan.findUnique({
      where: { code: input.planCode },
    });
    if (!plan || !plan.isActive) {
      throw new BadRequestException(`Unknown or inactive plan ${input.planCode}.`);
    }
    if (await this.db.client.tenant.findUnique({ where: { slug: code }, select: { id: true } })) {
      throw new ConflictException(`The hospital code ${code} is already taken.`);
    }

    const { token, hash } = generateInvitationToken();
    const result = await this.db.client.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({ data: { slug: code, name: input.name.trim() } });
      await tx.tenantSubscription.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + SUBSCRIPTION_YEAR_MS),
        },
      });
      const invitation = await tx.staffInvitation.create({
        data: {
          tenantId: tenant.id,
          displayName: input.adminName.trim(),
          phoneE164: phone,
          email: input.adminEmail?.trim().toLowerCase() || null,
          roles: ['HOSPITAL_ADMIN'],
          tokenHash: hash,
          expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
          invitedByPlatformUserId: auth.platformUserId,
        },
      });
      await this.audit.record(
        {
          action: 'TENANT_ONBOARDED',
          outcome: 'SUCCESS',
          actorPlatformUserId: auth.platformUserId,
          tenantId: tenant.id,
          targetType: 'tenant',
          targetId: tenant.id,
          metadata: { planCode: plan.code, adminInvitationId: invitation.id },
          request: meta,
        },
        tx,
      );
      return { tenant, invitation };
    });

    await this.sendInvite(phone, result.tenant, token);
    return {
      tenantId: result.tenant.id,
      code,
      status: result.tenant.status,
      adminInvitationId: result.invitation.id,
      adminInvitationExpiresAt: result.invitation.expiresAt,
    };
  }

  /** New first-admin invitation for a hospital that is still onboarding. */
  async resendAdminInvitation(
    auth: PlatformAuthContext,
    tenantId: string,
    meta: RequestMeta,
    now: Date = new Date(),
  ) {
    const tenant = await this.requireTenant(tenantId);
    if (tenant.status !== 'ONBOARDING') {
      throw new ConflictException(
        'This hospital already has an active admin; they invite staff themselves.',
      );
    }
    const previous = await this.db.client.staffInvitation.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    if (!previous) {
      throw new NotFoundException('This hospital has no admin invitation to resend.');
    }
    const { token, hash } = generateInvitationToken();
    const invitation = await this.db.client.staffInvitation.create({
      data: {
        tenantId,
        displayName: previous.displayName,
        phoneE164: previous.phoneE164,
        email: previous.email,
        roles: ['HOSPITAL_ADMIN'],
        tokenHash: hash,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        invitedByPlatformUserId: auth.platformUserId,
      },
    });
    await this.audit.record({
      action: 'ADMIN_INVITATION_CREATED',
      outcome: 'SUCCESS',
      actorPlatformUserId: auth.platformUserId,
      tenantId,
      targetType: 'staff_invitation',
      targetId: invitation.id,
      request: meta,
    });
    await this.sendInvite(previous.phoneE164, tenant, token);
    return { adminInvitationId: invitation.id, adminInvitationExpiresAt: invitation.expiresAt };
  }

  async list() {
    const [tenants, usage] = await Promise.all([
      this.db.client.tenant.findMany({
        orderBy: { name: 'asc' },
        include: {
          subscriptions: {
            where: { status: { not: 'CANCELLED' } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            include: {
              plan: { select: { code: true, name: true, maxBranches: true, maxStaffUsers: true } },
            },
          },
        },
      }),
      this.usageByTenant(),
    ]);
    return tenants.map((tenant) => this.summary(tenant, usage.get(tenant.id)));
  }

  async detail(tenantId: string) {
    const tenant = await this.db.client.tenant.findUnique({
      where: { id: tenantId },
      include: {
        subscriptions: { orderBy: { createdAt: 'desc' }, include: { plan: true } },
      },
    });
    if (!tenant) {
      throw new NotFoundException('No hospital with that ID.');
    }
    const [usage, adminInvitations] = await Promise.all([
      this.usageByTenant(),
      // Platform-created rows only (enforced by RLS); no token hashes leave this method.
      this.db.client.staffInvitation.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          displayName: true,
          status: true,
          expiresAt: true,
          acceptedAt: true,
          createdAt: true,
        },
      }),
    ]);
    const current = tenant.subscriptions.find((s) => s.status !== 'CANCELLED');
    return {
      ...this.summary({ ...tenant, subscriptions: current ? [current] : [] }, usage.get(tenant.id)),
      branchScopeMode: tenant.branchScopeMode,
      staffMfaMode: tenant.staffMfaMode,
      subscriptions: tenant.subscriptions.map((s) => ({
        id: s.id,
        planCode: s.plan.code,
        status: s.status,
        currentPeriodStart: s.currentPeriodStart,
        currentPeriodEnd: s.currentPeriodEnd,
        cancelledAt: s.cancelledAt,
      })),
      adminInvitations: adminInvitations.map((i) => ({
        ...i,
        status: i.status === 'PENDING' && i.expiresAt <= new Date() ? 'EXPIRED' : i.status,
      })),
    };
  }

  /** Cancels the current subscription and starts a new one on the chosen plan. */
  async changePlan(
    auth: PlatformAuthContext,
    tenantId: string,
    planCode: string,
    meta: RequestMeta,
    now: Date = new Date(),
  ) {
    await this.requireTenant(tenantId);
    const plan = await this.db.client.subscriptionPlan.findUnique({ where: { code: planCode } });
    if (!plan || !plan.isActive) {
      throw new BadRequestException(`Unknown or inactive plan ${planCode}.`);
    }
    await this.db.client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
      const current = await tx.tenantSubscription.findFirst({
        where: { tenantId, status: { not: 'CANCELLED' } },
        orderBy: { createdAt: 'desc' },
      });
      if (current) {
        await tx.tenantSubscription.update({
          where: { id: current.id },
          data: { status: 'CANCELLED', cancelledAt: now },
        });
      }
      await tx.tenantSubscription.create({
        data: {
          tenantId,
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + SUBSCRIPTION_YEAR_MS),
        },
      });
      await this.audit.record(
        {
          action: 'TENANT_PLAN_CHANGED',
          outcome: 'SUCCESS',
          actorPlatformUserId: auth.platformUserId,
          tenantId,
          targetType: 'tenant',
          targetId: tenantId,
          metadata: { planCode },
          request: meta,
        },
        tx,
      );
    });
    return this.detail(tenantId);
  }

  /** Suspension ends every session of the hospital at once (ADR-0004 section 3). */
  async setSuspended(
    auth: PlatformAuthContext,
    tenantId: string,
    suspended: boolean,
    meta: RequestMeta,
  ) {
    const tenant = await this.requireTenant(tenantId);
    const from = suspended ? 'ACTIVE' : 'SUSPENDED';
    if (tenant.status !== from) {
      throw new ConflictException(
        suspended
          ? 'Only an active hospital can be suspended.'
          : 'Only a suspended hospital can be reactivated.',
      );
    }
    await this.db.client.tenant.update({
      where: { id: tenantId },
      data: { status: suspended ? 'SUSPENDED' : 'ACTIVE' },
    });
    await this.audit.record({
      action: suspended ? 'TENANT_SUSPENDED' : 'TENANT_REACTIVATED',
      outcome: 'SUCCESS',
      actorPlatformUserId: auth.platformUserId,
      tenantId,
      targetType: 'tenant',
      targetId: tenantId,
      request: meta,
    });
    return this.detail(tenantId);
  }

  private async requireTenant(tenantId: string) {
    const tenant = await this.db.client.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('No hospital with that ID.');
    }
    return tenant;
  }

  private async usageByTenant(): Promise<Map<string, UsageRow>> {
    const rows = await this.db.client.$queryRaw<UsageRow[]>`SELECT * FROM tenant_usage()`;
    return new Map(rows.map((row) => [row.tenant_id, row]));
  }

  private summary(
    tenant: {
      id: string;
      slug: string;
      name: string;
      status: string;
      createdAt: Date;
      subscriptions: Array<{
        status: string;
        currentPeriodEnd: Date;
        plan: { code: string; name: string; maxBranches: number; maxStaffUsers: number };
      }>;
    },
    usage: UsageRow | undefined,
  ) {
    const subscription = tenant.subscriptions[0];
    return {
      id: tenant.id,
      code: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      createdAt: tenant.createdAt,
      plan: subscription
        ? {
            code: subscription.plan.code,
            name: subscription.plan.name,
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd,
            maxBranches: subscription.plan.maxBranches,
            maxStaffUsers: subscription.plan.maxStaffUsers,
          }
        : null,
      usage: {
        activeBranches: usage?.active_branches ?? 0,
        activeStaff: usage?.active_staff ?? 0,
        pendingInvitations: usage?.pending_invitations ?? 0,
      },
    };
  }

  private async sendInvite(phone: string, tenant: { slug: string; name: string }, token: string) {
    try {
      await this.sms.sendInvitation(
        phone,
        tenant.name,
        invitationLink(this.webAppUrl, tenant.slug, token),
      );
    } catch (error) {
      this.logger.error(
        `Admin invitation SMS failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
