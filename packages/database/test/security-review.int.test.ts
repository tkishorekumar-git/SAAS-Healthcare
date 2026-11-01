/**
 * ADR-0005: known devices are tenant-isolated, and the clean-up function removes only
 * authentication data that is past retention - enforced by PostgreSQL. All data is synthetic.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient } from '../src/client';
import type { PrismaClient } from '../src/generated/prisma/client';
import { withTenant } from '../src/tenant';

const urls = inject('databaseUrls');
// Random, so values never collide with other suites sharing the test database.
const nextHash = () => randomBytes(32).toString('hex');
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);

let app: PrismaClient;
let platform: PrismaClient;
let tenantA: string;
let tenantB: string;
let userA: string;
let userB: string;
let platformUser: string;

async function createUser(tenantId: string, phone: string): Promise<string> {
  return withTenant(
    app,
    tenantId,
    async (tx) =>
      (
        await tx.user.create({
          data: {
            tenantId,
            accountKind: 'STAFF',
            displayName: 'Synthetic Staff',
            phoneE164: phone,
          },
        })
      ).id,
  );
}

beforeAll(async () => {
  app = createPrismaClient(urls.app, { maxConnections: 2 });
  platform = createPrismaClient(urls.platform, { maxConnections: 2 });
  tenantA = (
    await platform.tenant.create({ data: { slug: 'sec-a', name: 'Sec A', status: 'ACTIVE' } })
  ).id;
  tenantB = (
    await platform.tenant.create({ data: { slug: 'sec-b', name: 'Sec B', status: 'ACTIVE' } })
  ).id;
  userA = await createUser(tenantA, '+919500000001');
  userB = await createUser(tenantB, '+919500000002');
  platformUser = (
    await platform.platformUser.create({
      data: {
        email: 'sec.super@platform.example.test',
        displayName: 'Synthetic Super Admin',
        passwordHash: '$argon2id$synthetic',
        totpSecretEncrypted: 'v1.synthetic',
      },
    })
  ).id;
});

afterAll(async () => {
  await app?.$disconnect();
  await platform?.$disconnect();
});

describe('known_devices', () => {
  it('is visible only inside its own hospital', async () => {
    await withTenant(app, tenantB, (tx) =>
      tx.knownDevice.create({ data: { tenantId: tenantB, userId: userB, deviceHash: nextHash() } }),
    );
    const seenFromA = await withTenant(app, tenantA, (tx) => tx.knownDevice.findMany());
    expect(seenFromA).toEqual([]);
  });

  it("cannot be created for another hospital's user", async () => {
    await expect(
      withTenant(app, tenantA, (tx) =>
        tx.knownDevice.create({
          data: { tenantId: tenantB, userId: userB, deviceHash: nextHash() },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(app, tenantA, (tx) =>
        tx.knownDevice.create({
          data: { tenantId: tenantA, userId: userB, deviceHash: nextHash() },
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects anything but a SHA-256 hex hash', async () => {
    await expect(
      withTenant(app, tenantA, (tx) =>
        tx.knownDevice.create({
          data: {
            tenantId: tenantA,
            userId: userA,
            deviceHash: 'raw-device-token'.padEnd(64, 'x'),
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it('cannot be deleted by the API role', async () => {
    await expect(
      withTenant(app, tenantA, (tx) => tx.$executeRaw`DELETE FROM known_devices`),
    ).rejects.toThrow(/permission denied/);
  });

  it('is invisible to the platform role', async () => {
    await expect(platform.knownDevice.findMany()).rejects.toThrow(/permission denied/);
  });
});

describe('purge_expired_auth_data()', () => {
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    for (const [tenantId, userId, key] of [
      [tenantA, userA, 'A'],
      [tenantB, userB, 'B'],
    ] as const) {
      await withTenant(app, tenantId, async (tx) => {
        const otp = (expiresAt: Date) =>
          tx.otpChallenge.create({
            data: {
              tenantId,
              userId,
              purpose: 'STAFF_MFA',
              phoneE164: '+919500000001',
              codeHmac: nextHash(),
              expiresAt,
            },
          });
        ids[`otpOld${key}`] = (await otp(daysAgo(2))).id;
        ids[`otpLive${key}`] = (await otp(inDays(1))).id;

        const session = (data: { expiresAt: Date; revokedAt?: Date }) =>
          tx.session.create({
            data: {
              tenantId,
              userId,
              client: 'WEB',
              refreshTokenHash: nextHash(),
              absoluteExpiresAt: inDays(30),
              ...data,
            },
          });
        ids[`sessionRevokedOld${key}`] = (
          await session({ expiresAt: inDays(1), revokedAt: daysAgo(91) })
        ).id;
        ids[`sessionExpiredOld${key}`] = (await session({ expiresAt: daysAgo(91) })).id;
        ids[`sessionRecentlyRevoked${key}`] = (
          await session({ expiresAt: inDays(1), revokedAt: daysAgo(5) })
        ).id;
        ids[`sessionLive${key}`] = (await session({ expiresAt: inDays(1) })).id;

        const invitation = (expiresAt: Date) =>
          tx.staffInvitation.create({
            data: {
              tenantId,
              displayName: 'Synthetic Invitee',
              phoneE164: '+919500000009',
              roles: ['NURSE'],
              tokenHash: nextHash(),
              expiresAt,
              invitedByUserId: userId,
            },
          });
        ids[`invitationOld${key}`] = (await invitation(daysAgo(91))).id;
        ids[`invitationLive${key}`] = (await invitation(inDays(3))).id;

        const device = (lastSeenAt: Date) =>
          tx.knownDevice.create({ data: { tenantId, userId, deviceHash: nextHash(), lastSeenAt } });
        ids[`deviceOld${key}`] = (await device(daysAgo(400))).id;
        ids[`deviceLive${key}`] = (await device(daysAgo(10))).id;
      });
    }
    const platformSession = (data: { expiresAt: Date; revokedAt?: Date }) =>
      platform.platformSession.create({
        data: {
          platformUserId: platformUser,
          refreshTokenHash: nextHash(),
          idleTimeoutSecs: 900,
          ...data,
        },
      });
    ids.platformSessionOld = (await platformSession({ expiresAt: daysAgo(91) })).id;
    ids.platformSessionLive = (await platformSession({ expiresAt: inDays(1) })).id;
  });

  async function remaining() {
    const perTenant = async (tenantId: string) =>
      withTenant(app, tenantId, async (tx) => ({
        otp: (await tx.otpChallenge.findMany({ select: { id: true } })).map((r) => r.id),
        sessions: (await tx.session.findMany({ select: { id: true } })).map((r) => r.id),
        invitations: (await tx.staffInvitation.findMany({ select: { id: true } })).map((r) => r.id),
        devices: (await tx.knownDevice.findMany({ select: { id: true } })).map((r) => r.id),
      }));
    return {
      A: await perTenant(tenantA),
      B: await perTenant(tenantB),
      platformSessions: (await platform.platformSession.findMany({ select: { id: true } })).map(
        (r) => r.id,
      ),
    };
  }

  it('cannot be called by the platform role', async () => {
    await expect(platform.$queryRaw`SELECT * FROM purge_expired_auth_data()`).rejects.toThrow(
      /permission denied/,
    );
  });

  it('is the only way the API role can delete these rows', async () => {
    await expect(
      withTenant(app, tenantA, (tx) => tx.$executeRaw`DELETE FROM otp_challenges`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      withTenant(app, tenantA, (tx) => tx.$executeRaw`DELETE FROM sessions`),
    ).rejects.toThrow(/permission denied/);
  });

  it('removes only rows past retention, in every hospital', async () => {
    const [counts] = await app.$queryRaw<
      Array<Record<string, number>>
    >`SELECT * FROM purge_expired_auth_data()`;
    // At least this suite's expired rows; other suites share the database. The checks below
    // prove exactly which of this suite's rows went.
    expect(counts!.otp_challenges).toBeGreaterThanOrEqual(2);
    expect(counts!.sessions).toBeGreaterThanOrEqual(4);
    expect(counts!.platform_sessions).toBeGreaterThanOrEqual(1);
    expect(counts!.staff_invitations).toBeGreaterThanOrEqual(2);
    expect(counts!.known_devices).toBeGreaterThanOrEqual(2);

    const left = await remaining();
    for (const key of ['A', 'B'] as const) {
      expect(left[key].otp).toEqual([ids[`otpLive${key}`]]);
      expect(left[key].sessions.sort()).toEqual(
        [ids[`sessionRecentlyRevoked${key}`], ids[`sessionLive${key}`]].sort(),
      );
      expect(left[key].invitations).toEqual([ids[`invitationLive${key}`]]);
      expect(left[key].devices).toContain(ids[`deviceLive${key}`]);
      expect(left[key].devices).not.toContain(ids[`deviceOld${key}`]);
    }
    expect(left.platformSessions).toContain(ids.platformSessionLive);
    expect(left.platformSessions).not.toContain(ids.platformSessionOld);
  });

  it('removes nothing when run again', async () => {
    const [counts] = await app.$queryRaw<
      Array<Record<string, number>>
    >`SELECT * FROM purge_expired_auth_data()`;
    expect(Object.values(counts!)).toEqual([0, 0, 0, 0, 0]);
  });
});
