import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, hasPermissions, permissionsForRoles } from './permissions';
import { USER_ROLES } from './roles';

describe('permissions', () => {
  it('defines permissions for every role, using only known permissions', () => {
    for (const role of USER_ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });

  it('gives Hospital Admin every tenant permission', () => {
    expect([...permissionsForRoles(['HOSPITAL_ADMIN'])].sort()).toEqual([...PERMISSIONS].sort());
  });

  it('gives Super Admin no tenant permissions', () => {
    expect(permissionsForRoles(['SUPER_ADMIN']).size).toBe(0);
  });

  it('does not let clinical staff or patients manage staff or read the audit log', () => {
    for (const role of ['DOCTOR', 'NURSE', 'PATIENT', 'PARENT_GUARDIAN'] as const) {
      expect(hasPermissions([role], ['staff:manage'])).toBe(false);
      expect(hasPermissions([role], ['audit:read'])).toBe(false);
    }
  });

  it('combines permissions across multiple roles', () => {
    expect(hasPermissions(['NURSE', 'HOSPITAL_MANAGEMENT'], ['branch:read', 'audit:read'])).toBe(
      true,
    );
  });
});
