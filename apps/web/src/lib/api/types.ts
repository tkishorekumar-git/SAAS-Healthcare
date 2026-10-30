/**
 * Response shapes of the Kenisha API as used by the web app. They mirror the API's Swagger
 * DTOs (see /api/docs); a later milestone can generate them from the OpenAPI document.
 */
import type { HealthcareModuleKey, StaffRole } from '@kenisha/shared';

export interface TenantOverview {
  id: string;
  code: string;
  name: string;
  status: 'ONBOARDING' | 'ACTIVE' | 'SUSPENDED';
  branchScopeMode: 'TENANT_WIDE' | 'ASSIGNED_BRANCHES';
  staffMfaMode: 'ALL_STAFF' | 'ADMINS_ONLY';
  plan: {
    code: string | null;
    name: string | null;
    subscriptionStatus: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | null;
    currentPeriodEnd: string | null;
    maxBranches: number;
    maxStaffUsers: number;
    enabledModules: HealthcareModuleKey[];
    canGrow: boolean;
  };
  usage: { activeBranches: number; activeStaff: number; pendingInvitations: number };
}

export interface StaffMember {
  userId: string;
  displayName: string;
  phoneE164: string;
  email: string | null;
  roles: StaffRole[];
  branchIds: string[];
  status: 'ACTIVE' | 'DISABLED';
  locked: boolean;
  createdAt: string;
}

export interface Invitation {
  id: string;
  displayName: string;
  phoneE164: string;
  email: string | null;
  roles: StaffRole[];
  branchIds: string[];
  status: 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'REVOKED';
  expiresAt: string;
  invitedBy: 'HOSPITAL' | 'KENISHA';
  createdAt: string;
}

export interface Branch {
  id: string;
  code: string;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string | null;
  countryCode: string;
  phone: string | null;
  isActive: boolean;
}

export interface SupportAccessRequest {
  id: string;
  requesterName: string;
  reason: string;
  requestedMinutes: number;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REVOKED';
  active: boolean;
  approvedUntil: string | null;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  outcome: 'SUCCESS' | 'FAILURE';
  actorUserId: string | null;
  targetType: string | null;
  targetId: string | null;
  createdAt: string;
}

export interface PlatformTenantSummary {
  id: string;
  code: string;
  name: string;
  status: 'ONBOARDING' | 'ACTIVE' | 'SUSPENDED';
  createdAt: string;
  plan: {
    code: string;
    name: string;
    status: string;
    currentPeriodEnd: string;
    maxBranches: number;
    maxStaffUsers: number;
  } | null;
  usage: { activeBranches: number; activeStaff: number; pendingInvitations: number };
}

export interface PlatformTenantDetail extends PlatformTenantSummary {
  branchScopeMode: string;
  staffMfaMode: string;
  subscriptions: Array<{
    id: string;
    planCode: string;
    status: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    cancelledAt: string | null;
  }>;
  adminInvitations: Array<{
    id: string;
    displayName: string;
    status: string;
    expiresAt: string;
    acceptedAt: string | null;
    createdAt: string;
  }>;
}

export interface PlatformSupportRequest {
  id: string;
  tenantId: string;
  requesterName: string;
  reason: string;
  requestedMinutes: number;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REVOKED';
  approvedUntil: string | null;
  createdAt: string;
  tenant: { slug: string; name: string };
}

export interface PlatformMe {
  platformUserId: string;
  email: string;
  displayName: string;
}
