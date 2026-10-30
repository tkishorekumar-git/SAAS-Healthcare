import type { TenantTransaction } from '@kenisha/database';
import type { StaffRole } from '@kenisha/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type AuditAction, AuditService } from '../audit/audit.service';
import type { AuthContext, RequestMeta } from '../auth/auth-context';
import { TenantDatabase } from '../database/tenant-database.service';
import { PlanLimitsService } from '../tenancy/plan-limits.service';
import { normalizeRoles } from './invitations.service';

export interface StaffMemberView {
  userId: string;
  displayName: string;
  phoneE164: string;
  email: string | null;
  roles: StaffRole[];
  branchIds: string[];
  status: 'ACTIVE' | 'DISABLED';
  locked: boolean;
  createdAt: Date;
}

const STAFF_SELECT = {
  id: true,
  displayName: true,
  phoneE164: true,
  email: true,
  status: true,
  createdAt: true,
  roles: { select: { role: true } },
  branchAssignments: { select: { branchId: true } },
  passwordCredential: { select: { lockedUntil: true } },
} as const;

/**
 * Hospital Admin staff management (ADR-0004 section 2). Safeguards: an admin cannot change
 * or disable themself, and a hospital always keeps at least one active Hospital Admin.
 * Changes that reduce someone's access end their sessions immediately.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly db: TenantDatabase,
    private readonly limits: PlanLimitsService,
    private readonly audit: AuditService,
  ) {}

  list(auth: AuthContext, now: Date = new Date()): Promise<StaffMemberView[]> {
    return this.db.run(auth.tenantId, async (tx) => {
      const users = await tx.user.findMany({
        where: { accountKind: 'STAFF' },
        orderBy: { displayName: 'asc' },
        select: STAFF_SELECT,
      });
      return users.map((user) => toView(user, now));
    });
  }

  setRoles(auth: AuthContext, userId: string, roles: string[], meta: RequestMeta) {
    const next = normalizeRoles(roles);
    return this.change(auth, userId, meta, 'STAFF_ROLES_CHANGED', async (tx, user) => {
      if (user.roles.includes('HOSPITAL_ADMIN') && !next.includes('HOSPITAL_ADMIN')) {
        await this.assertAnotherActiveAdmin(tx, auth, userId);
      }
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.userRole.createMany({
        data: next.map((role) => ({ tenantId: auth.tenantId, userId, role })),
      });
      await this.endSessions(tx, userId, 'ROLES_CHANGED');
      return { roles: next.join(',') };
    });
  }

  setBranches(auth: AuthContext, userId: string, branchIds: string[], meta: RequestMeta) {
    const unique = [...new Set(branchIds)];
    return this.change(auth, userId, meta, 'STAFF_BRANCHES_CHANGED', async (tx) => {
      const found = await tx.branch.count({ where: { id: { in: unique }, isActive: true } });
      if (found !== unique.length) {
        throw new BadRequestException('One or more branches do not exist or are inactive.');
      }
      await tx.staffBranchAssignment.deleteMany({ where: { userId } });
      if (unique.length > 0) {
        await tx.staffBranchAssignment.createMany({
          data: unique.map((branchId) => ({ tenantId: auth.tenantId, userId, branchId })),
        });
      }
      return { branches: unique.length };
    });
  }

  disable(auth: AuthContext, userId: string, meta: RequestMeta) {
    return this.change(auth, userId, meta, 'STAFF_DISABLED', async (tx, user) => {
      if (user.status === 'DISABLED') {
        throw new ConflictException('This account is already disabled.');
      }
      if (user.roles.includes('HOSPITAL_ADMIN')) {
        await this.assertAnotherActiveAdmin(tx, auth, userId);
      }
      await tx.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });
      await this.endSessions(tx, userId, 'USER_DISABLED');
      return {};
    });
  }

  enable(auth: AuthContext, userId: string, meta: RequestMeta, now: Date = new Date()) {
    return this.change(auth, userId, meta, 'STAFF_ENABLED', async (tx, user) => {
      if (user.status === 'ACTIVE') {
        throw new ConflictException('This account is already active.');
      }
      await this.limits.assertCanAddStaff(tx, auth.tenantId, now);
      await tx.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } });
      return {};
    });
  }

  unlock(auth: AuthContext, userId: string, meta: RequestMeta) {
    return this.change(auth, userId, meta, 'STAFF_UNLOCKED', async (tx) => {
      await tx.passwordCredential.updateMany({
        where: { userId },
        data: { failedAttempts: 0, lockedUntil: null },
      });
      return {};
    });
  }

  private async change(
    auth: AuthContext,
    userId: string,
    meta: RequestMeta,
    action: AuditAction,
    apply: (
      tx: TenantTransaction,
      user: { status: 'ACTIVE' | 'DISABLED'; roles: StaffRole[] },
    ) => Promise<Record<string, string | number | boolean>>,
    now: Date = new Date(),
  ): Promise<StaffMemberView> {
    if (userId === auth.userId) {
      throw new ForbiddenException(
        'You cannot change your own account here. Ask another Hospital Admin.',
      );
    }
    return this.db.run(auth.tenantId, async (tx) => {
      await this.limits.lockTenant(tx, auth.tenantId);
      const user = await tx.user.findFirst({
        where: { id: userId, accountKind: 'STAFF' },
        select: STAFF_SELECT,
      });
      if (!user) {
        throw new NotFoundException('No staff member with that ID.');
      }
      const metadata = await apply(tx, {
        status: user.status,
        roles: user.roles.map((r) => r.role as StaffRole),
      });
      await this.audit.record(tx, auth.tenantId, {
        action,
        outcome: 'SUCCESS',
        actorUserId: auth.userId,
        targetType: 'user',
        targetId: userId,
        metadata,
        request: meta,
      });
      const updated = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: STAFF_SELECT,
      });
      return toView(updated, now);
    });
  }

  /** Called with the tenant row locked, so concurrent changes cannot remove the last admin. */
  private async assertAnotherActiveAdmin(tx: TenantTransaction, auth: AuthContext, userId: string) {
    const others = await tx.user.count({
      where: {
        id: { not: userId },
        accountKind: 'STAFF',
        status: 'ACTIVE',
        roles: { some: { role: 'HOSPITAL_ADMIN' } },
      },
    });
    if (others === 0) {
      throw new ConflictException('A hospital must keep at least one active Hospital Admin.');
    }
  }

  private async endSessions(tx: TenantTransaction, userId: string, reason: string) {
    await tx.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }
}

function toView(
  user: {
    id: string;
    displayName: string;
    phoneE164: string;
    email: string | null;
    status: 'ACTIVE' | 'DISABLED';
    createdAt: Date;
    roles: Array<{ role: string }>;
    branchAssignments: Array<{ branchId: string }>;
    passwordCredential: { lockedUntil: Date | null } | null;
  },
  now: Date,
): StaffMemberView {
  const lockedUntil = user.passwordCredential?.lockedUntil ?? null;
  return {
    userId: user.id,
    displayName: user.displayName,
    phoneE164: user.phoneE164,
    email: user.email,
    roles: user.roles.map((r) => r.role as StaffRole),
    branchIds: user.branchAssignments.map((a) => a.branchId),
    status: user.status,
    locked: lockedUntil !== null && lockedUntil > now,
    createdAt: user.createdAt,
  };
}
