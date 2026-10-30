/**
 * ADR-0003 identity tables: tenant isolation, append-only audit, immutable columns,
 * composite foreign keys and the pre-login hospital lookup. All data is synthetic.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient } from '../src/client';
import type { PrismaClient } from '../src/generated/prisma/client';
import { resolveTenantByCode, withTenant } from '../src/tenant';

const urls = inject('databaseUrls');
const HMAC = 'a'.repeat(64);

let app: PrismaClient;
let platform: PrismaClient;
let tenantA: string;
let tenantB: string;
let userA: string;
let userB: string;
let branchB: string;

beforeAll(async () => {
  app = createPrismaClient(urls.app, { maxConnections: 2 });
  platform = createPrismaClient(urls.platform, { maxConnections: 2 });

  tenantA = (
    await platform.tenant.create({
      data: { slug: 'id-hospital-a', name: 'ID Hospital A', status: 'ACTIVE' },
    })
  ).id;
  tenantB = (
    await platform.tenant.create({ data: { slug: 'id-hospital-b', name: 'ID Hospital B' } })
  ).id;

  userA = await withTenant(app, tenantA, async (tx) => {
    const user = await tx.user.create({
      data: {
        tenantId: tenantA,
        accountKind: 'STAFF',
        displayName: 'Synthetic Doctor A',
        phoneE164: '+919000000001',
        email: 'doctor.a@example.test',
        roles: { create: { role: 'DOCTOR' } },
      },
    });
    await tx.passwordCredential.create({
      data: { tenantId: tenantA, userId: user.id, passwordHash: '$argon2id$synthetic' },
    });
    await tx.session.create({
      data: {
        tenantId: tenantA,
        userId: user.id,
        client: 'WEB',
        refreshTokenHash: HMAC,
        expiresAt: new Date(Date.now() + 3_600_000),
        absoluteExpiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    await tx.auditEvent.create({
      data: { tenantId: tenantA, actorUserId: user.id, action: 'AUTH_LOGIN', outcome: 'SUCCESS' },
    });
    return user.id;
  });

  ({ userB, branchB } = await withTenant(app, tenantB, async (tx) => {
    const user = await tx.user.create({
      data: {
        tenantId: tenantB,
        accountKind: 'STAFF',
        displayName: 'Synthetic Doctor B',
        phoneE164: '+919000000001', // same number, different hospital: allowed (ADR-0002, D1)
      },
    });
    const branch = await tx.branch.create({
      data: { tenantId: tenantB, code: 'MAIN', name: 'B Main', city: 'Nagpur', state: 'MH' },
    });
    return { userB: user.id, branchB: branch.id };
  }));
});

afterAll(async () => {
  await Promise.all([app?.$disconnect(), platform?.$disconnect()]);
});

describe('resolveTenantByCode (pre-login hospital lookup)', () => {
  it('returns only the tenant ID and active flag, case-insensitively', async () => {
    await expect(resolveTenantByCode(app, '  ID-Hospital-A ')).resolves.toEqual({
      tenantId: tenantA,
      isActive: true,
    });
    await expect(resolveTenantByCode(app, 'id-hospital-b')).resolves.toEqual({
      tenantId: tenantB,
      isActive: false,
    });
  });

  it('returns null for unknown or malformed codes', async () => {
    await expect(resolveTenantByCode(app, 'no-such-hospital')).resolves.toBeNull();
    await expect(resolveTenantByCode(app, "x'; DROP TABLE tenants; --")).resolves.toBeNull();
  });

  it('exposes no other tenant columns', async () => {
    const rows = await app.$queryRaw<Record<string, unknown>[]>`
      SELECT * FROM resolve_tenant('id-hospital-a')`;
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual(['is_active', 'tenant_id']);
  });

  it('cannot be called by the platform role', async () => {
    await expect(platform.$queryRaw`SELECT * FROM resolve_tenant('id-hospital-a')`).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe('identity tables are isolated per hospital', () => {
  it('users, roles, credentials, sessions and audit are invisible across tenants', async () => {
    const seenByB = await withTenant(app, tenantB, async (tx) => ({
      users: await tx.user.findMany(),
      roles: await tx.userRole.count(),
      credentials: await tx.passwordCredential.count(),
      sessions: await tx.session.count(),
      audit: await tx.auditEvent.count(),
    }));

    expect(seenByB.users.map((u) => u.id)).toEqual([userB]);
    expect(seenByB).toMatchObject({ roles: 0, credentials: 0, sessions: 0, audit: 0 });
  });

  it('sees nothing without a tenant context', async () => {
    await expect(app.user.count()).resolves.toBe(0);
    await expect(app.session.count()).resolves.toBe(0);
  });

  it('rejects a duplicate phone number within the same hospital and account kind', async () => {
    await expect(
      withTenant(app, tenantA, (tx) =>
        tx.user.create({
          data: {
            tenantId: tenantA,
            accountKind: 'STAFF',
            displayName: 'Duplicate',
            phoneE164: '+919000000001',
          },
        }),
      ),
    ).rejects.toThrow(/unique/i);
  });

  it('cannot link a user to another hospital’s branch (composite foreign key)', async () => {
    await expect(
      withTenant(app, tenantA, (tx) =>
        tx.staffBranchAssignment.create({
          data: { tenantId: tenantA, userId: userA, branchId: branchB },
        }),
      ),
    ).rejects.toThrow(/foreign key/i);
  });

  it('cannot attach another hospital’s user to a session', async () => {
    await expect(
      withTenant(app, tenantA, (tx) =>
        tx.session.create({
          data: {
            tenantId: tenantA,
            userId: userB,
            client: 'WEB',
            refreshTokenHash: HMAC,
            expiresAt: new Date(Date.now() + 60_000),
            absoluteExpiresAt: new Date(Date.now() + 60_000),
          },
        }),
      ),
    ).rejects.toThrow(/foreign key/i);
  });
});

describe('immutable and append-only data', () => {
  it('audit events cannot be updated or deleted', async () => {
    await expect(
      withTenant(app, tenantA, (tx) => tx.auditEvent.updateMany({ data: { outcome: 'FAILURE' } })),
    ).rejects.toThrow(/permission denied/i);
    await expect(withTenant(app, tenantA, (tx) => tx.auditEvent.deleteMany())).rejects.toThrow(
      /permission denied/i,
    );
  });

  it('a session cannot be reassigned to another user', async () => {
    await expect(
      withTenant(app, tenantA, (tx) => tx.session.updateMany({ data: { userId: userA } })),
    ).rejects.toThrow(/permission denied/i);
  });

  it('a one-time code hash cannot be rewritten', async () => {
    const challenge = await withTenant(app, tenantA, (tx) =>
      tx.otpChallenge.create({
        data: {
          tenantId: tenantA,
          purpose: 'PERSONAL_LOGIN',
          phoneE164: '+919000000099',
          codeHmac: HMAC,
          expiresAt: new Date(Date.now() + 300_000),
        },
      }),
    );
    await expect(
      withTenant(app, tenantA, (tx) =>
        tx.otpChallenge.update({ where: { id: challenge.id }, data: { codeHmac: 'b'.repeat(64) } }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it('users cannot be deleted (disable instead)', async () => {
    await expect(
      withTenant(app, tenantA, (tx) => tx.user.deleteMany({ where: { id: userA } })),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('platform role has no access to identity data (ADR-0002, D2)', () => {
  it.each([
    ['users', () => platform.user.findMany()],
    ['password_credentials', () => platform.passwordCredential.findMany()],
    ['sessions', () => platform.session.findMany()],
    ['otp_challenges', () => platform.otpChallenge.findMany()],
    ['audit_events', () => platform.auditEvent.findMany()],
  ])('%s', async (_table, query) => {
    await expect(query()).rejects.toThrow(/permission denied/i);
  });
});
