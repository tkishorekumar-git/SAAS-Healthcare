/**
 * ADR-0004: staff invitations, the narrow platform grant, the usage function and one-way
 * tenant activation - all enforced by PostgreSQL. All data is synthetic.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient } from '../src/client';
import type { PrismaClient } from '../src/generated/prisma/client';
import { withTenant } from '../src/tenant';

const urls = inject('databaseUrls');
let hashCounter = 0;
const nextHash = () => (hashCounter += 1).toString(16).padStart(64, '0');
const inAWeek = () => new Date(Date.now() + 7 * 86_400_000);

let app: PrismaClient;
let platform: PrismaClient;
let tenantA: string;
let tenantB: string;
let tenantOnboarding: string;
let adminA: string;
let superAdmin: string;

function platformInvite(tenantId: string, overrides: Record<string, unknown> = {}) {
  return platform.staffInvitation.create({
    data: {
      tenantId,
      displayName: 'Synthetic First Admin',
      phoneE164: '+919400000001',
      roles: ['HOSPITAL_ADMIN'],
      tokenHash: nextHash(),
      expiresAt: inAWeek(),
      invitedByPlatformUserId: superAdmin,
      ...overrides,
    },
  });
}

function hospitalInvite(tenantId: string, overrides: Record<string, unknown> = {}) {
  return withTenant(app, tenantId, (tx) =>
    tx.staffInvitation.create({
      data: {
        tenantId,
        displayName: 'Synthetic Nurse',
        phoneE164: '+919400000002',
        roles: ['NURSE'],
        tokenHash: nextHash(),
        expiresAt: inAWeek(),
        invitedByUserId: adminA,
        ...overrides,
      },
    }),
  );
}

function activate(tenantId?: string) {
  const query = (client: { $queryRaw: PrismaClient['$queryRaw'] }) =>
    client.$queryRaw<Array<{ ok: boolean }>>`SELECT activate_onboarding_tenant() AS ok`;
  return tenantId ? withTenant(app, tenantId, (tx) => query(tx)) : query(app);
}

beforeAll(async () => {
  app = createPrismaClient(urls.app, { maxConnections: 2 });
  platform = createPrismaClient(urls.platform, { maxConnections: 2 });
  tenantA = (
    await platform.tenant.create({ data: { slug: 'inv-a', name: 'Inv A', status: 'ACTIVE' } })
  ).id;
  tenantB = (
    await platform.tenant.create({ data: { slug: 'inv-b', name: 'Inv B', status: 'ACTIVE' } })
  ).id;
  tenantOnboarding = (await platform.tenant.create({ data: { slug: 'inv-new', name: 'Inv New' } }))
    .id;
  superAdmin = (
    await platform.platformUser.create({
      data: {
        email: 'inv.super@platform.example.test',
        displayName: 'Synthetic Super Admin',
        passwordHash: '$argon2id$synthetic',
        totpSecretEncrypted: 'v1.synthetic',
      },
    })
  ).id;
  adminA = await withTenant(app, tenantA, async (tx) => {
    const user = await tx.user.create({
      data: {
        tenantId: tenantA,
        accountKind: 'STAFF',
        displayName: 'Synthetic Admin A',
        phoneE164: '+919400000099',
        roles: { create: { role: 'HOSPITAL_ADMIN' } },
      },
    });
    return user.id;
  });
});

afterAll(async () => {
  await Promise.all([app?.$disconnect(), platform?.$disconnect()]);
});

describe('the narrow platform grant on staff_invitations', () => {
  it('lets the platform invite a first Hospital Admin', async () => {
    await expect(platformInvite(tenantOnboarding)).resolves.toMatchObject({ status: 'PENDING' });
  });

  it.each([
    ['any other role', { roles: ['DOCTOR'] }],
    ['an extra role', { roles: ['HOSPITAL_ADMIN', 'DOCTOR'] }],
    ['branch assignments', { branchIds: ['0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'] }],
    ['a non-pending status', { status: 'REVOKED' }],
  ])('refuses platform invitations with %s', async (_case, overrides) => {
    await expect(platformInvite(tenantOnboarding, overrides)).rejects.toThrow();
  });

  it('shows the platform only platform-created invitations', async () => {
    const hospitalCreated = await hospitalInvite(tenantA);
    const seen = await platform.staffInvitation.findMany({ where: { id: hospitalCreated.id } });
    expect(seen).toEqual([]);
  });

  it('never lets the platform change an invitation', async () => {
    const invite = await platformInvite(tenantOnboarding, { phoneE164: '+919400000011' });
    await expect(
      platform.staffInvitation.update({ where: { id: invite.id }, data: { status: 'REVOKED' } }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('still gives the platform no access to hospital users', async () => {
    await expect(platform.user.findMany()).rejects.toThrow(/permission denied/i);
  });
});

describe('hospital-side invitations', () => {
  it('cannot forge a platform-created invitation', async () => {
    await expect(
      hospitalInvite(tenantA, {
        phoneE164: '+919400000003',
        roles: ['HOSPITAL_ADMIN'],
        invitedByUserId: null,
        invitedByPlatformUserId: superAdmin,
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot invite patients or guardians', async () => {
    await expect(hospitalInvite(tenantA, { roles: ['PATIENT'] })).rejects.toThrow(
      /staff_invitations_staff_roles_only/,
    );
  });

  it('is invisible to other hospitals', async () => {
    const invite = await hospitalInvite(tenantA, { phoneE164: '+919400000004' });
    const seen = await withTenant(app, tenantB, (tx) =>
      tx.staffInvitation.findMany({ where: { id: invite.id } }),
    );
    expect(seen).toEqual([]);
  });

  it('treats accepted and revoked invitations as final', async () => {
    const invite = await hospitalInvite(tenantA, { phoneE164: '+919400000005' });
    await withTenant(app, tenantA, (tx) =>
      tx.staffInvitation.update({ where: { id: invite.id }, data: { status: 'REVOKED' } }),
    );
    await expect(
      withTenant(app, tenantA, (tx) =>
        tx.staffInvitation.update({ where: { id: invite.id }, data: { status: 'PENDING' } }),
      ),
    ).rejects.toThrow(/already REVOKED/);
  });

  it('requires acceptance to record who accepted and when', async () => {
    const invite = await hospitalInvite(tenantA, { phoneE164: '+919400000006' });
    await expect(
      withTenant(app, tenantA, (tx) =>
        tx.staffInvitation.update({ where: { id: invite.id }, data: { status: 'ACCEPTED' } }),
      ),
    ).rejects.toThrow(/staff_invitations_acceptance_complete/);
  });
});

describe('tenant_usage() and activate_onboarding_tenant()', () => {
  it('gives the platform counts only', async () => {
    const rows = await platform.$queryRaw<Record<string, unknown>[]>`
      SELECT * FROM tenant_usage() WHERE tenant_id = ${tenantA}::uuid`;
    expect(Object.keys(rows[0]!).sort()).toEqual([
      'active_branches',
      'active_staff',
      'pending_invitations',
      'tenant_id',
    ]);
    expect(rows[0]).toMatchObject({ active_staff: 1 });
  });

  it('is not callable by the hospital role', async () => {
    await expect(
      withTenant(app, tenantA, (tx) => tx.$queryRaw`SELECT * FROM tenant_usage()`),
    ).rejects.toThrow(/permission denied/i);
  });

  it('activates only the current tenant, and only from ONBOARDING', async () => {
    expect((await activate(tenantA))[0]!.ok).toBe(false);

    await platform.tenant.update({ where: { id: tenantB }, data: { status: 'SUSPENDED' } });
    expect((await activate(tenantB))[0]!.ok).toBe(false);
    expect((await platform.tenant.findUniqueOrThrow({ where: { id: tenantB } })).status).toBe(
      'SUSPENDED',
    );

    expect((await activate(tenantOnboarding))[0]!.ok).toBe(true);
    expect(
      (await platform.tenant.findUniqueOrThrow({ where: { id: tenantOnboarding } })).status,
    ).toBe('ACTIVE');
  });

  it('does nothing without a tenant context', async () => {
    expect((await activate())[0]!.ok).toBe(false);
  });
});
