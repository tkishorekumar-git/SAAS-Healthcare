import type { UserRole } from './roles';

/**
 * Coarse capabilities granted by role (ADR-0003 §6). Resource checks — tenant, branch
 * scope, care relationships — are applied on top of these in the API services.
 */
export const PERMISSIONS = [
  'profile:read',
  'tenant:read',
  'tenant:settings',
  'branch:read',
  'branch:manage',
  'staff:read',
  'staff:manage',
  'audit:read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const BASE: readonly Permission[] = ['profile:read', 'tenant:read', 'branch:read'];

export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = {
  // Platform staff use separate /platform endpoints and never hold tenant permissions.
  SUPER_ADMIN: [],
  HOSPITAL_ADMIN: PERMISSIONS,
  HOSPITAL_MANAGEMENT: [...BASE, 'staff:read', 'audit:read'],
  DOCTOR: BASE,
  NURSE: BASE,
  RECEPTIONIST: BASE,
  LAB_TECHNICIAN: BASE,
  PHARMACIST: BASE,
  PATIENT: BASE,
  PARENT_GUARDIAN: BASE,
};

/** Roles that always see every branch and always need the SMS second factor. */
export const HOSPITAL_ADMIN_ROLES: readonly UserRole[] = ['HOSPITAL_ADMIN', 'HOSPITAL_MANAGEMENT'];

export function permissionsForRoles(roles: readonly UserRole[]): Set<Permission> {
  return new Set(roles.flatMap((role) => ROLE_PERMISSIONS[role]));
}

export function hasPermissions(
  roles: readonly UserRole[],
  required: readonly Permission[],
): boolean {
  const granted = permissionsForRoles(roles);
  return required.every((permission) => granted.has(permission));
}
