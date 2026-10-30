import type { TenantTransaction } from '@kenisha/database';
import type { HealthcareModuleKey, TenantId } from '@kenisha/shared';
import { ConflictException, Injectable } from '@nestjs/common';

export interface PlanLimits {
  planCode: string | null;
  planName: string | null;
  subscriptionStatus: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | null;
  currentPeriodEnd: Date | null;
  maxBranches: number;
  maxStaffUsers: number;
  enabledModules: HealthcareModuleKey[];
  /** False for PAST_DUE or no subscription: the hospital keeps working but cannot grow. */
  canGrow: boolean;
}

export interface Usage {
  activeBranches: number;
  activeStaff: number;
  pendingInvitations: number;
}

const NO_PLAN: PlanLimits = {
  planCode: null,
  planName: null,
  subscriptionStatus: null,
  currentPeriodEnd: null,
  maxBranches: 0,
  maxStaffUsers: 0,
  enabledModules: [],
  canGrow: false,
};

/**
 * Plan limits (ADR-0004 section 4). Every check that precedes a change runs in the same
 * transaction and first locks the tenant row, so two admins cannot take the last slot.
 */
@Injectable()
export class PlanLimitsService {
  async limits(tx: TenantTransaction): Promise<PlanLimits> {
    const subscription = await tx.tenantSubscription.findFirst({
      where: { status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
    if (!subscription || subscription.status === 'CANCELLED') {
      return NO_PLAN;
    }
    return {
      planCode: subscription.plan.code,
      planName: subscription.plan.name,
      subscriptionStatus: subscription.status,
      currentPeriodEnd: subscription.currentPeriodEnd,
      maxBranches: subscription.plan.maxBranches,
      maxStaffUsers: subscription.plan.maxStaffUsers,
      enabledModules: subscription.plan.includedModules,
      canGrow: subscription.status === 'ACTIVE' || subscription.status === 'TRIALING',
    };
  }

  async usage(tx: TenantTransaction, now: Date = new Date()): Promise<Usage> {
    const [activeBranches, activeStaff, pendingInvitations] = await Promise.all([
      tx.branch.count({ where: { isActive: true } }),
      tx.user.count({ where: { accountKind: 'STAFF', status: 'ACTIVE' } }),
      tx.staffInvitation.count({ where: { status: 'PENDING', expiresAt: { gt: now } } }),
    ]);
    return { activeBranches, activeStaff, pendingInvitations };
  }

  /** Serialises plan-limited changes for one hospital until the transaction ends. */
  async lockTenant(tx: TenantTransaction, tenantId: TenantId): Promise<void> {
    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
  }

  async assertCanAddBranch(tx: TenantTransaction, tenantId: TenantId): Promise<void> {
    await this.lockTenant(tx, tenantId);
    const limits = await this.limits(tx);
    this.assertCanGrow(limits);
    const { activeBranches } = await this.usage(tx);
    if (activeBranches >= limits.maxBranches) {
      throw new ConflictException(
        `Your ${limits.planName} plan allows ${limits.maxBranches} active branch(es). ` +
          'Deactivate a branch or ask Kenisha to upgrade your plan.',
      );
    }
  }

  /** Active staff plus pending invitations must stay within the plan (ADR-0004 T4). */
  async assertCanAddStaff(tx: TenantTransaction, tenantId: TenantId, now: Date): Promise<void> {
    await this.lockTenant(tx, tenantId);
    const limits = await this.limits(tx);
    this.assertCanGrow(limits);
    const { activeStaff, pendingInvitations } = await this.usage(tx, now);
    if (activeStaff + pendingInvitations >= limits.maxStaffUsers) {
      throw new ConflictException(
        `Your ${limits.planName} plan allows ${limits.maxStaffUsers} staff accounts ` +
          `(${activeStaff} active, ${pendingInvitations} invited). ` +
          'Disable an account, revoke an invitation or ask Kenisha to upgrade your plan.',
      );
    }
  }

  private assertCanGrow(limits: PlanLimits): void {
    if (!limits.canGrow) {
      throw new ConflictException(
        limits.subscriptionStatus === 'PAST_DUE'
          ? 'Your subscription payment is overdue. Existing staff and branches keep working, ' +
              'but new ones cannot be added until it is settled.'
          : 'Your hospital has no active subscription. Please contact Kenisha.',
      );
    }
  }
}
