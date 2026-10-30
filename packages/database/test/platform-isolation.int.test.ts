/**
 * ADR-0003 section 4 and 8: platform tables are invisible to hospitals, and break-glass
 * requests can be created by the platform but decided only by the hospital, within the
 * rules enforced by PostgreSQL itself. All data is synthetic.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient } from '../src/client';
import type { PrismaClient } from '../src/generated/prisma/client';
import { withTenant } from '../src/tenant';

const urls = inject('databaseUrls');
const REASON = 'Synthetic support ticket SUP-1234: hospital cannot see branch list';

let app: PrismaClient;
let platform: PrismaClient;
let tenantA: string;
let tenantB: string;
let adminA: string;
let superAdmin: string;

async function newRequest(minutes = 60): Promise<string> {
  const request = await platform.supportAccessRequest.create({
    data: {
      tenantId: tenantA,
      requestedById: superAdmin,
      requesterName: 'Synthetic Super Admin',
      reason: REASON,
      requestedMinutes: minutes,
    },
  });
  return request.id;
}

function decide(id: string, data: Record<string, unknown>, tenantId = tenantA) {
  return withTenant(app, tenantId, (tx) => tx.supportAccessRequest.update({ where: { id }, data }));
}

beforeAll(async () => {
  app = createPrismaClient(urls.app, { maxConnections: 2 });
  platform = createPrismaClient(urls.platform, { maxConnections: 2 });

  tenantA = (await platform.tenant.create({ data: { slug: 'pl-hospital-a', name: 'PL A' } })).id;
  tenantB = (await platform.tenant.create({ data: { slug: 'pl-hospital-b', name: 'PL B' } })).id;
  superAdmin = (
    await platform.platformUser.create({
      data: {
        email: 'super@platform.example.test',
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
        phoneE164: '+919500000001',
        roles: { create: { role: 'HOSPITAL_ADMIN' } },
      },
    });
    return user.id;
  });
});

afterAll(async () => {
  await Promise.all([app?.$disconnect(), platform?.$disconnect()]);
});

describe('platform tables are invisible to the hospital role', () => {
  it.each([
    ['platform_users', () => withTenant(app, tenantA, (tx) => tx.platformUser.findMany())],
    ['platform_sessions', () => withTenant(app, tenantA, (tx) => tx.platformSession.findMany())],
    [
      'platform_audit_events',
      () => withTenant(app, tenantA, (tx) => tx.platformAuditEvent.findMany()),
    ],
  ])('%s', async (_table, query) => {
    await expect(query()).rejects.toThrow(/permission denied/i);
  });
});

describe('break-glass requests', () => {
  it('the platform can request access but never approve it itself', async () => {
    const id = await newRequest();
    await expect(
      platform.supportAccessRequest.update({ where: { id }, data: { status: 'APPROVED' } }),
    ).rejects.toThrow(/permission denied/i);
  });

  it('the platform cannot create a request that is already decided', async () => {
    await expect(
      platform.supportAccessRequest.create({
        data: {
          tenantId: tenantA,
          requestedById: superAdmin,
          requesterName: 'Synthetic Super Admin',
          reason: REASON,
          requestedMinutes: 60,
          status: 'APPROVED',
          decidedByUserId: adminA,
          decidedAt: new Date(),
          approvedUntil: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow();
  });

  it('the hospital can approve its own request within the requested duration', async () => {
    const id = await newRequest(30);
    const now = new Date();
    const approved = await decide(id, {
      status: 'APPROVED',
      decidedByUserId: adminA,
      decidedAt: now,
      approvedUntil: new Date(now.getTime() + 30 * 60_000),
    });
    expect(approved.status).toBe('APPROVED');
  });

  it('approval cannot outlast the requested duration', async () => {
    const id = await newRequest(30);
    const now = new Date();
    await expect(
      decide(id, {
        status: 'APPROVED',
        decidedByUserId: adminA,
        decidedAt: now,
        approvedUntil: new Date(now.getTime() + 31 * 60_000),
      }),
    ).rejects.toThrow(/support_access_approval_window/);
  });

  it('another hospital cannot see or decide the request', async () => {
    const id = await newRequest();
    const seen = await withTenant(app, tenantB, (tx) =>
      tx.supportAccessRequest.findMany({ where: { id } }),
    );
    expect(seen).toEqual([]);
    const changed = await withTenant(app, tenantB, (tx) =>
      tx.supportAccessRequest.updateMany({ where: { id }, data: { status: 'REJECTED' } }),
    );
    expect(changed.count).toBe(0);
  });

  it('only REQUESTED -> APPROVED/REJECTED and APPROVED -> REVOKED are allowed', async () => {
    const rejected = await newRequest();
    await decide(rejected, { status: 'REJECTED', decidedByUserId: adminA, decidedAt: new Date() });
    await expect(
      decide(rejected, { status: 'APPROVED', approvedUntil: new Date(Date.now() + 60_000) }),
    ).rejects.toThrow(/cannot move from REJECTED to APPROVED/);

    const approved = await newRequest();
    const now = new Date();
    await decide(approved, {
      status: 'APPROVED',
      decidedByUserId: adminA,
      decidedAt: now,
      approvedUntil: new Date(now.getTime() + 10 * 60_000),
    });
    await expect(decide(approved, { status: 'REQUESTED' })).rejects.toThrow(
      /cannot move from APPROVED to REQUESTED/,
    );

    const revoked = await decide(approved, { status: 'REVOKED' });
    expect(revoked.approvedUntil!.getTime()).toBeLessThanOrEqual(Date.now());
    await expect(decide(approved, { status: 'APPROVED' })).rejects.toThrow(/cannot move/);
  });

  it('rejects durations over 4 hours and reasons that are too short', async () => {
    await expect(newRequest(241)).rejects.toThrow(/support_access_duration/);
    await expect(
      platform.supportAccessRequest.create({
        data: {
          tenantId: tenantA,
          requestedById: superAdmin,
          requesterName: 'x',
          reason: 'too short',
          requestedMinutes: 60,
        },
      }),
    ).rejects.toThrow(/support_access_reason_length/);
  });
});
