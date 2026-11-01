/**
 * ADR-0005 section 1: tenant isolation at the API layer, and no PHI in logs or errors.
 *
 * Hospital A's admin (every hospital permission) attacks every hospital route that takes an
 * ID with Hospital B's IDs. Each attempt must fail as "not found" — never succeed, never leak
 * data — and B's rows must be unchanged. The route list is checked against the live route
 * inventory, so a new ID-bearing endpoint fails this suite until it is covered here.
 *
 * Distinctive synthetic "canary" names and phone numbers are planted in both hospitals; every
 * message the API logs during the suite (at every level) is recorded and must not contain them.
 */
import { type PrismaClient, createPrismaClient, withTenant } from '@kenisha/database';
import type { INestApplication, LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/auth/password/password-hasher';
import { hasPermissions } from '@kenisha/shared';
import { listRoutes } from '../src/auth/route-access';
import { SMS_PROVIDER } from '../src/auth/sms/sms.provider';
import { configureApp } from '../src/bootstrap/configure-app';
import { AuthDataPurgeService } from '../src/maintenance/auth-data-purge.service';
import type { Env } from '../src/config/env.validation';
import { CapturingSms } from './support/capturing-sms';

const PASSWORD = 'Monsoon-Ledger-47-Banyan';
const CANARIES = {
  adminA: { name: 'Quorra Vantablack', phone: '+919120000001' },
  staffA: { name: 'Ignatius Pemberbrook', phone: '+919120000002' },
  staffB: { name: 'Zenobia Quillfeather', phone: '+919120000003' },
  patientA: { name: 'Ottoline Fairweather', phone: '+919120000005' },
  inviteeB: { name: 'Thaddeus Marrowgate', phone: '+919120000004' },
};
const CANARY_STRINGS = Object.values(CANARIES).flatMap(({ name, phone }) => [
  name,
  phone,
  phone.slice(-10),
]);

let app: INestApplication<App>;
let sms: CapturingSms;
let platform: PrismaClient;
let db: PrismaClient;
let tokenA: string;
const ids: Record<string, string> = {};
const output: string[] = [];

const api = () => request(app.getHttpServer());
const asA = () => ({ Authorization: `Bearer ${tokenA}` });

/**
 * Records every log call at every level, including the levels Nest's testing logger
 * normally discards, with all arguments (messages, contexts, stack traces).
 */
class RecordingLogger implements LoggerService {
  private record(...args: unknown[]): void {
    output.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  }
  log = (...args: unknown[]) => this.record(...args);
  error = (...args: unknown[]) => this.record(...args);
  warn = (...args: unknown[]) => this.record(...args);
  debug = (...args: unknown[]) => this.record(...args);
  verbose = (...args: unknown[]) => this.record(...args);
  fatal = (...args: unknown[]) => this.record(...args);
}

async function createStaff(
  tenantId: string,
  person: { name: string; phone: string },
  roles: Array<'HOSPITAL_ADMIN' | 'DOCTOR'>,
  branchIds: string[] = [],
): Promise<string> {
  const passwordHash = await hashPassword(PASSWORD);
  return withTenant(db, tenantId, async (tx) => {
    const user = await tx.user.create({
      data: {
        tenantId,
        accountKind: 'STAFF',
        displayName: person.name,
        phoneE164: person.phone,
        roles: { create: roles.map((role) => ({ role })) },
      },
    });
    await tx.passwordCredential.create({ data: { tenantId, userId: user.id, passwordHash } });
    for (const branchId of branchIds) {
      await tx.staffBranchAssignment.create({ data: { tenantId, userId: user.id, branchId } });
    }
    return user.id;
  });
}

/** Everything about B that an attack could change, for before/after comparison. */
function snapshotB() {
  return withTenant(db, ids.tenantB!, async (tx) => ({
    branches: await tx.branch.findMany({ orderBy: { id: 'asc' } }),
    users: await tx.user.findMany({ orderBy: { id: 'asc' }, include: { roles: true } }),
    assignments: await tx.staffBranchAssignment.findMany({ orderBy: { id: 'asc' } }),
    invitations: await tx.staffInvitation.findMany({ orderBy: { id: 'asc' } }),
    support: await tx.supportAccessRequest.findMany({ orderBy: { id: 'asc' } }),
  }));
}

beforeAll(async () => {
  platform = createPrismaClient(process.env.KENISHA_E2E_PLATFORM_URL!, { maxConnections: 2 });
  db = createPrismaClient(process.env.KENISHA_E2E_APP_URL!, { maxConnections: 2 });

  const plan = await platform.subscriptionPlan.create({
    data: {
      code: 'ISO_PLAN',
      name: 'Isolation',
      includedModules: ['HOSPITAL'],
      maxBranches: 10,
      maxStaffUsers: 20,
    },
  });
  for (const key of ['A', 'B'] as const) {
    const tenant = await platform.tenant.create({
      data: { slug: `iso-${key.toLowerCase()}`, name: `Isolation ${key}`, status: 'ACTIVE' },
    });
    await platform.tenantSubscription.create({
      data: {
        tenantId: tenant.id,
        planId: plan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      },
    });
    ids[`tenant${key}`] = tenant.id;
    ids[`branch${key}`] = await withTenant(
      db,
      tenant.id,
      async (tx) =>
        (
          await tx.branch.create({
            data: { tenantId: tenant.id, code: 'MAIN', name: 'Main', city: 'Pune', state: 'MH' },
          })
        ).id,
    );
  }

  ids.adminA = await createStaff(ids.tenantA!, CANARIES.adminA, ['HOSPITAL_ADMIN']);
  ids.staffA = await createStaff(ids.tenantA!, CANARIES.staffA, ['DOCTOR'], [ids.branchA!]);
  await withTenant(db, ids.tenantA!, (tx) =>
    tx.user.create({
      data: {
        tenantId: ids.tenantA!,
        accountKind: 'PERSONAL',
        displayName: CANARIES.patientA.name,
        phoneE164: CANARIES.patientA.phone,
        roles: { create: { role: 'PATIENT' } },
      },
    }),
  );
  ids.staffB = await createStaff(ids.tenantB!, CANARIES.staffB, ['DOCTOR'], [ids.branchB!]);

  ids.invitationB = await withTenant(
    db,
    ids.tenantB!,
    async (tx) =>
      (
        await tx.staffInvitation.create({
          data: {
            tenantId: ids.tenantB!,
            displayName: CANARIES.inviteeB.name,
            phoneE164: CANARIES.inviteeB.phone,
            roles: ['NURSE'],
            branchIds: [ids.branchB!],
            tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
            expiresAt: new Date(Date.now() + 86_400_000),
            invitedByUserId: ids.staffB,
          },
        })
      ).id,
  );

  const ops = await platform.platformUser.create({
    data: {
      email: 'iso.ops@platform.example.test',
      displayName: 'Synthetic Iso Ops',
      passwordHash: 'unused',
      totpSecretEncrypted: 'unused',
    },
  });
  ids.supportB = (
    await platform.supportAccessRequest.create({
      data: {
        tenantId: ids.tenantB!,
        requestedById: ops.id,
        requesterName: 'Synthetic Iso Ops',
        reason: 'Synthetic isolation test',
        requestedMinutes: 30,
      },
    })
  ).id;

  sms = new CapturingSms();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SMS_PROVIDER)
    .useValue(sms)
    .compile();
  app = moduleRef.createNestApplication();
  app.useLogger(new RecordingLogger());
  configureApp(app, app.get<ConfigService<Env, true>>(ConfigService));
  await app.init();

  const first = await api()
    .post('/api/v1/auth/staff/login')
    .send({
      hospitalCode: 'iso-a',
      identifier: CANARIES.adminA.phone,
      password: PASSWORD,
      client: 'mobile',
    })
    .expect(200);
  const verified = await api()
    .post('/api/v1/auth/staff/mfa/verify')
    .send({
      hospitalCode: 'iso-a',
      challengeId: first.body.challengeId,
      code: sms.lastCodeFor(CANARIES.adminA.phone),
      client: 'mobile',
    })
    .expect(200);
  tokenA = verified.body.accessToken;
});

afterAll(async () => {
  await app?.close();
  await platform?.$disconnect();
  await db?.$disconnect();
});

/** [route as in the inventory, concrete path, body] — every one uses one of B's IDs. */
function attacks(): Array<[string, string, object]> {
  return [
    ['PATCH /branches/:id', `/branches/${ids.branchB}`, { name: 'Hijacked' }],
    ['POST /branches/:id/deactivate', `/branches/${ids.branchB}/deactivate`, {}],
    ['POST /branches/:id/reactivate', `/branches/${ids.branchB}/reactivate`, {}],
    ['PUT /staff/:userId/roles', `/staff/${ids.staffB}/roles`, { roles: ['HOSPITAL_ADMIN'] }],
    ['PUT /staff/:userId/branches', `/staff/${ids.staffB}/branches`, { branchIds: [] }],
    ['POST /staff/:userId/disable', `/staff/${ids.staffB}/disable`, {}],
    ['POST /staff/:userId/enable', `/staff/${ids.staffB}/enable`, {}],
    ['POST /staff/:userId/unlock', `/staff/${ids.staffB}/unlock`, {}],
    ['POST /staff-invitations/:id/resend', `/staff-invitations/${ids.invitationB}/resend`, {}],
    ['POST /staff-invitations/:id/revoke', `/staff-invitations/${ids.invitationB}/revoke`, {}],
    [
      'POST /support-access-requests/:id/approve',
      `/support-access-requests/${ids.supportB}/approve`,
      {},
    ],
    [
      'POST /support-access-requests/:id/reject',
      `/support-access-requests/${ids.supportB}/reject`,
      {},
    ],
    [
      'POST /support-access-requests/:id/revoke',
      `/support-access-requests/${ids.supportB}/revoke`,
      {},
    ],
  ];
}

describe('patients on staff endpoints', () => {
  it('a patient token is refused by every route needing a permission patients lack', async () => {
    const requested = await api()
      .post('/api/v1/auth/otp/request')
      .send({ hospitalCode: 'iso-a', phone: CANARIES.patientA.phone })
      .expect(202);
    const verified = await api()
      .post('/api/v1/auth/otp/verify')
      .send({
        hospitalCode: 'iso-a',
        challengeId: requested.body.challengeId,
        code: sms.lastCodeFor(CANARIES.patientA.phone),
        client: 'mobile',
      })
      .expect(200);
    const patient = { Authorization: `Bearer ${verified.body.accessToken}` };

    const staffOnly = listRoutes(
      app.get(DiscoveryService),
      app.get(MetadataScanner),
      app.get(Reflector),
    ).filter(
      (entry) => entry.access === 'permissions' && !hasPermissions(['PATIENT'], entry.permissions),
    );
    expect(staffOnly.length).toBeGreaterThan(10);
    for (const { route } of staffOnly) {
      const [method, path] = route.split(' ') as [string, string];
      const url = `/api/v1${path.replace(/:[a-zA-Z]+/g, ids.staffA!)}`;
      const response = await api()
        [method.toLowerCase() as 'get' | 'post' | 'put' | 'patch'](url)
        .set(patient)
        .send({});
      expect({ route, status: response.status }).toEqual({ route, status: 403 });
    }
  });
});

describe('cross-tenant attacks through the API', () => {
  it('covers every hospital route that takes an ID', () => {
    const idRoutes = listRoutes(
      app.get(DiscoveryService),
      app.get(MetadataScanner),
      app.get(Reflector),
    )
      .filter((entry) => entry.access === 'permissions' && entry.route.includes('/:'))
      .map((entry) => entry.route)
      .sort();
    expect(
      attacks()
        .map(([route]) => route)
        .sort(),
    ).toEqual(idRoutes);
  });

  it("refuses every write to Hospital B's records and leaves them unchanged", async () => {
    const before = await snapshotB();
    for (const [route, path, body] of attacks()) {
      const method = route.split(' ')[0]!.toLowerCase() as 'patch' | 'post' | 'put';
      const response = await api()[method](`/api/v1${path}`).set(asA()).send(body);
      expect({ route, status: response.status }).toEqual({ route, status: 404 });
      expect(JSON.stringify(response.body)).not.toContain(ids.tenantB);
    }
    expect(await snapshotB()).toEqual(before);
  });

  it("cannot attach Hospital B's branch to Hospital A's staff or invitations", async () => {
    const before = await snapshotB();
    const assign = await api()
      .put(`/api/v1/staff/${ids.staffA}/branches`)
      .set(asA())
      .send({ branchIds: [ids.branchB] });
    expect(assign.status).toBeGreaterThanOrEqual(400);
    expect(assign.status).toBeLessThan(500);

    const invite = await api()
      .post('/api/v1/staff-invitations')
      .set(asA())
      .send({
        displayName: 'Synthetic Cross Invitee',
        phone: '+919120000099',
        roles: ['NURSE'],
        branchIds: [ids.branchB],
      });
    expect(invite.status).toBeGreaterThanOrEqual(400);
    expect(invite.status).toBeLessThan(500);
    expect(await snapshotB()).toEqual(before);
  });

  it("never lists Hospital B's records", async () => {
    const lists = [
      '/branches',
      '/staff',
      '/staff-invitations',
      '/support-access-requests',
      '/audit-events',
      '/tenant',
    ];
    for (const path of lists) {
      const response = await api().get(`/api/v1${path}`).set(asA()).expect(200);
      const text = JSON.stringify(response.body);
      for (const key of ['tenantB', 'branchB', 'staffB', 'invitationB', 'supportB']) {
        expect({ path, leaked: text.includes(ids[key]!) }).toEqual({ path, leaked: false });
      }
      expect(text).not.toContain(CANARIES.staffB.name);
      expect(text).not.toContain(CANARIES.inviteeB.name);
    }
  });

  it('ignores a tenant ID smuggled into a request', async () => {
    const response = await api()
      .patch('/api/v1/tenant')
      .set(asA())
      .send({ tenantId: ids.tenantB, name: 'Hijacked' });
    expect(response.status).toBe(400);
  });
});

describe('expired authentication data', () => {
  it('the API can run the clean-up and it leaves live data alone', async () => {
    const before = await snapshotB();
    await app.get(AuthDataPurgeService).purge();
    expect(output.join(' ')).not.toContain('purge failed');
    expect(await snapshotB()).toEqual(before);
  });
});

describe('no PHI in logs or error responses', () => {
  it('error responses for unknown IDs do not reveal anything', async () => {
    const response = await api()
      .post(`/api/v1/staff/${ids.staffB}/disable`)
      .set(asA())
      .send({})
      .expect(404);
    const text = JSON.stringify(response.body);
    for (const canary of CANARY_STRINGS) expect(text).not.toContain(canary);
  });

  it('nothing the API wrote to its logs contains a canary name or phone number', () => {
    // Runs last in this file: covers logins, SMS delivery, every attack and error above.
    expect(output.length).toBeGreaterThan(0);
    const logs = output.join('');
    for (const canary of CANARY_STRINGS) {
      expect({ canary, found: logs.includes(canary) }).toEqual({ canary, found: false });
    }
  });
});
