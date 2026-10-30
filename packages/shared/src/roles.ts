/**
 * Platform roles. Roles grant coarse capabilities; resource-based checks
 * (tenant, branch, care relationship, guardianship) are layered on top in the API.
 */
export const USER_ROLES = [
  'SUPER_ADMIN',
  'HOSPITAL_ADMIN',
  'HOSPITAL_MANAGEMENT',
  'DOCTOR',
  'NURSE',
  'RECEPTIONIST',
  'LAB_TECHNICIAN',
  'PHARMACIST',
  'PATIENT',
  'PARENT_GUARDIAN',
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export type RoleScope = 'PLATFORM' | 'TENANT_STAFF' | 'CARE_RECIPIENT';

export const ROLE_SCOPES: Readonly<Record<UserRole, RoleScope>> = {
  SUPER_ADMIN: 'PLATFORM',
  HOSPITAL_ADMIN: 'TENANT_STAFF',
  HOSPITAL_MANAGEMENT: 'TENANT_STAFF',
  DOCTOR: 'TENANT_STAFF',
  NURSE: 'TENANT_STAFF',
  RECEPTIONIST: 'TENANT_STAFF',
  LAB_TECHNICIAN: 'TENANT_STAFF',
  PHARMACIST: 'TENANT_STAFF',
  PATIENT: 'CARE_RECIPIENT',
  PARENT_GUARDIAN: 'CARE_RECIPIENT',
};

export const ROLE_LABELS: Readonly<Record<UserRole, string>> = {
  SUPER_ADMIN: 'Super Admin',
  HOSPITAL_ADMIN: 'Hospital Admin',
  HOSPITAL_MANAGEMENT: 'Hospital Management',
  DOCTOR: 'Doctor',
  NURSE: 'Nurse',
  RECEPTIONIST: 'Receptionist',
  LAB_TECHNICIAN: 'Lab Technician',
  PHARMACIST: 'Pharmacist',
  PATIENT: 'Patient',
  PARENT_GUARDIAN: 'Parent / Guardian',
};

/** Roles a hospital can give its staff (never platform or care-recipient roles). */
export const STAFF_ROLES = USER_ROLES.filter(
  (role): role is Exclude<UserRole, 'SUPER_ADMIN' | 'PATIENT' | 'PARENT_GUARDIAN'> =>
    ROLE_SCOPES[role] === 'TENANT_STAFF',
);

export type StaffRole = (typeof STAFF_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

/** Only platform-scoped roles may operate across tenants. */
export function isCrossTenantRole(role: UserRole): boolean {
  return ROLE_SCOPES[role] === 'PLATFORM';
}
