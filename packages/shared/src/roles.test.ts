import { describe, expect, it } from 'vitest';
import { ROLE_LABELS, ROLE_SCOPES, USER_ROLES, isCrossTenantRole, isUserRole } from './roles';

describe('roles', () => {
  it('defines a scope and label for every role', () => {
    for (const role of USER_ROLES) {
      expect(ROLE_SCOPES[role]).toBeDefined();
      expect(ROLE_LABELS[role]).toBeTruthy();
    }
  });

  it('recognises valid roles and rejects anything else', () => {
    expect(isUserRole('DOCTOR')).toBe(true);
    expect(isUserRole('doctor')).toBe(false);
    expect(isUserRole('ROOT')).toBe(false);
    expect(isUserRole(42)).toBe(false);
  });

  it('allows only Super Admin to operate across tenants', () => {
    const crossTenant = USER_ROLES.filter(isCrossTenantRole);
    expect(crossTenant).toEqual(['SUPER_ADMIN']);
  });
});
