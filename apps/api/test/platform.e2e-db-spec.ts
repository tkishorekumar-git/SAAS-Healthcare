/**
 * ADR-0003 sections 4 and 8 end to end: Super Admin login with an authenticator app,
 * strict separation of platform and hospital tokens, and the full break-glass flow.
 * Real NestJS app, real PostgreSQL with RLS. All data is synthetic.
 */
import { type PrismaClient, createPrismaClient, withTenant } from '@kenisha/database';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loadSecretBoxKey, sealSecret } from '../src/auth/crypto/secret-box';
import { generateTotpSecret, totpCodeForStep, totpStep } from '../src/auth/crypto/totp';
import { hashPassword } from '../src/auth/password/password-hasher';
import { SMS_PROVIDER, type SmsProvider } from '../src/auth/sms/sms.provider';
import { configureApp } from '../src/bootstrap/configure-app';
import type { Env } from '../src/config/env.validation';

const PASSWORD = 'Monsoon-Ledger-47-Banyan';
const REASON = 'Synthetic ticket SUP-2001: hospital admin cannot see the branch list';

class CapturingSms implements SmsProvider {
  readonly sent: Array<{ phone: string; code: string }> = [];
  async sendOneTimeCode(phone: string, code: string): Promise<void> {
    this.sent.push({ phone, code });
  }
  lastCodeFor(phone: string): string {
    const message = [...this.sent].reverse().find((m) => m.phone === phone);
    if (!message) throw new Error(`no SMS sent to ${phone}`);
    return message.code;
  }
}

let app: INestApplication<App>;
let sms: CapturingSms;
let platform: PrismaClient;
let db: PrismaClient;
const secrets: Record<string, string> = {};
const ids: Record<string, string> = {};

const api = () => request(app.getHttpServer());
const bearer = (token: string) => `Bearer ${token}`;

async function createSuperAdmin(key: string, email: string): Promise<void> {
  const secret = generateTotpSecret();
  secrets[key] = secret;
  const user = await platform.platformUser.create({
    data: {
      email,
      displayName: `Synthetic ${key}`,
      passwordHash: await hashPassword(PASSWORD),
      totpSecretEncrypted: sealSecret(secret, loadSecretBoxKey(process.env.PLATFORM_TOTP_KEY!)),
    },
  });
  ids[key] = user.id;
}

/** Code for "now" plus an offset in 30-second steps (drift of ±1 step is accepted). */
const codeFor = (key: string, stepOffset = 0) =>
  totpCodeForStep(secrets[key]!, totpStep(new Date()) + stepOffset);

/** `stepOffset` 1 = next window's code, needed when this account already used the current one. */
async function superAdminSignIn(key: string, email: string, stepOffset = 0): Promise<string> {
  const step1 = await api()
    .post('/api/v1/platform/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const step2 = await api()
    .post('/api/v1/platform/auth/totp/verify')
    .send({ mfaToken: step1.body.mfaToken, code: codeFor(key, stepOffset) })
    .expect(200);
  return step2.body.accessToken as string;
}

async function staffSignIn(hospitalCode: string, email: string, phone: string): Promise<string> {
  const first = await api()
    .post('/api/v1/auth/staff/login')
    .send({ hospitalCode, identifier: email, password: PASSWORD, client: 'mobile' })
    .expect(200);
  const verified = await api()
    .post('/api/v1/auth/staff/mfa/verify')
    .send({
      hospitalCode,
      challengeId: first.body.challengeId,
      code: sms.lastCodeFor(phone),
      client: 'mobile',
    })
    .expect(200);
  return verified.body.accessToken as string;
}

async function createStaff(
  tenantId: string,
  key: string,
  phone: string,
  email: string,
  role: 'HOSPITAL_ADMIN' | 'DOCTOR',
) {
  const passwordHash = await hashPassword(PASSWORD);
  ids[key] = await withTenant(db, tenantId, async (tx) => {
    const user = await tx.user.create({
      data: {
        tenantId,
        accountKind: 'STAFF',
        displayName: `Synthetic ${key}`,
        phoneE164: phone,
        email,
        roles: { create: { role } },
      },
    });
    await tx.passwordCredential.create({ data: { tenantId, userId: user.id, passwordHash } });
    return user.id;
  });
}

beforeAll(async () => {
  platform = createPrismaClient(process.env.KENISHA_E2E_PLATFORM_URL!, { maxConnections: 2 });
  db = createPrismaClient(process.env.KENISHA_E2E_APP_URL!, { maxConnections: 2 });

  ids.gamma = (
    await platform.tenant.create({
      data: { slug: 'gamma-demo', name: 'Gamma Demo Hospital', status: 'ACTIVE' },
    })
  ).id;
  ids.delta = (
    await platform.tenant.create({
      data: { slug: 'delta-demo', name: 'Delta Demo Clinic', status: 'ACTIVE' },
    })
  ).id;
  await withTenant(db, ids.gamma, async (tx) => {
    await tx.branch.create({
      data: { tenantId: ids.gamma!, code: 'MAIN', name: 'Main', city: 'Mangaluru', state: 'KA' },
    });
    await tx.branch.create({
      data: {
        tenantId: ids.gamma!,
        code: 'OLD',
        name: 'Old',
        city: 'Mangaluru',
        state: 'KA',
        isActive: false,
      },
    });
  });
  await createStaff(
    ids.gamma,
    'gammaAdmin',
    '+919600000001',
    'admin@gamma.example.test',
    'HOSPITAL_ADMIN',
  );
  await createStaff(
    ids.gamma,
    'gammaDoctor',
    '+919600000002',
    'doctor@gamma.example.test',
    'DOCTOR',
  );
  await createStaff(
    ids.delta,
    'deltaAdmin',
    '+919700000001',
    'admin@delta.example.test',
    'HOSPITAL_ADMIN',
  );

  await createSuperAdmin('superA', 'super.a@platform.example.test');
  await createSuperAdmin('superB', 'super.b@platform.example.test');
  await createSuperAdmin('superReplay', 'super.replay@platform.example.test');
  await createSuperAdmin('superLock', 'super.lock@platform.example.test');

  sms = new CapturingSms();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SMS_PROVIDER)
    .useValue(sms)
    .compile();
  app = moduleRef.createNestApplication();
  configureApp(app, app.get<ConfigService<Env, true>>(ConfigService));
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await Promise.all([platform?.$disconnect(), db?.$disconnect()]);
});

describe('Super Admin login (password + authenticator app)', () => {
  it('rejects a wrong password generically', async () => {
    const response = await api()
      .post('/api/v1/platform/auth/login')
      .send({ email: 'super.a@platform.example.test', password: 'Wrong-Password-123' })
      .expect(401);
    expect(response.body.message).toBe('Invalid login details.');
  });

  it('needs the authenticator code, then issues a session with an HttpOnly cookie', async () => {
    const step1 = await api()
      .post('/api/v1/platform/auth/login')
      .send({ email: 'super.b@platform.example.test', password: PASSWORD })
      .expect(200);
    expect(step1.body.accessToken).toBeUndefined();

    await api()
      .post('/api/v1/platform/auth/totp/verify')
      .send({ mfaToken: step1.body.mfaToken, code: codeFor('superB', 5) })
      .expect(401);

    const step2 = await api()
      .post('/api/v1/platform/auth/totp/verify')
      .send({ mfaToken: step1.body.mfaToken, code: codeFor('superB') })
      .expect(200);
    const cookie = String(step2.headers['set-cookie']);
    expect(cookie).toMatch(/kenisha_prt=pt1\./);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/api\/v1\/platform\/auth/);

    const me = await api()
      .get('/api/v1/platform/auth/me')
      .set('Authorization', bearer(step2.body.accessToken))
      .expect(200);
    expect(me.body).toMatchObject({
      email: 'super.b@platform.example.test',
      roles: ['SUPER_ADMIN'],
    });
  });

  it('never accepts the same authenticator code twice', async () => {
    const code = codeFor('superReplay');
    const login = () =>
      api()
        .post('/api/v1/platform/auth/login')
        .send({ email: 'super.replay@platform.example.test', password: PASSWORD })
        .expect(200);

    const first = await login();
    await api()
      .post('/api/v1/platform/auth/totp/verify')
      .send({ mfaToken: first.body.mfaToken, code })
      .expect(200);
    const second = await login();
    await api()
      .post('/api/v1/platform/auth/totp/verify')
      .send({ mfaToken: second.body.mfaToken, code })
      .expect(401);
  });

  it('locks the account after 5 failures, even with the right password and code', async () => {
    for (let i = 0; i < 5; i += 1) {
      await api()
        .post('/api/v1/platform/auth/login')
        .send({ email: 'super.lock@platform.example.test', password: 'Wrong-Password-123' })
        .expect(401);
    }
    await api()
      .post('/api/v1/platform/auth/login')
      .send({ email: 'super.lock@platform.example.test', password: PASSWORD })
      .expect(401);
  });
});

describe('platform and hospital tokens never cross over', () => {
  it('a Super Admin token cannot call hospital endpoints', async () => {
    const superToken = await superAdminSignIn('superA', 'super.a@platform.example.test');
    for (const path of ['/api/v1/branches', '/api/v1/auth/me', '/api/v1/audit-events']) {
      await api().get(path).set('Authorization', bearer(superToken)).expect(401);
    }
    const tenants = await api()
      .get('/api/v1/platform/tenants')
      .set('Authorization', bearer(superToken))
      .expect(200);
    expect(tenants.body.map((t: { slug: string }) => t.slug)).toEqual(
      expect.arrayContaining(['gamma-demo', 'delta-demo']),
    );
    ids.superAToken = superToken;
  });

  it('a Hospital Admin token cannot call platform endpoints', async () => {
    const adminToken = await staffSignIn('gamma-demo', 'admin@gamma.example.test', '+919600000001');
    for (const path of [
      '/api/v1/platform/tenants',
      '/api/v1/platform/support-access',
      '/api/v1/platform/auth/me',
    ]) {
      await api().get(path).set('Authorization', bearer(adminToken)).expect(401);
    }
  });
});

describe('break-glass support access', () => {
  let requestId: string;
  let adminToken: string;
  let supportToken: string;

  it('validates the request', async () => {
    const superToken = ids.superAToken!;
    await api()
      .post('/api/v1/platform/support-access')
      .set('Authorization', bearer(superToken))
      .send({ hospitalCode: 'gamma-demo', reason: 'too short', durationMinutes: 30 })
      .expect(400);
    await api()
      .post('/api/v1/platform/support-access')
      .set('Authorization', bearer(superToken))
      .send({ hospitalCode: 'gamma-demo', reason: REASON, durationMinutes: 300 })
      .expect(400);
  });

  it('a Super Admin can request access but gets no token until the hospital approves', async () => {
    const created = await api()
      .post('/api/v1/platform/support-access')
      .set('Authorization', bearer(ids.superAToken!))
      .send({ hospitalCode: 'gamma-demo', reason: REASON, durationMinutes: 30 })
      .expect(201);
    requestId = created.body.id;
    expect(created.body.status).toBe('REQUESTED');

    await api()
      .post(`/api/v1/platform/support-access/${requestId}/token`)
      .set('Authorization', bearer(ids.superAToken!))
      .expect(403);
  });

  it('only that hospital’s admin can see and decide the request', async () => {
    const doctorToken = await staffSignIn(
      'gamma-demo',
      'doctor@gamma.example.test',
      '+919600000002',
    );
    await api()
      .get('/api/v1/support-access-requests')
      .set('Authorization', bearer(doctorToken))
      .expect(403);

    const deltaAdmin = await staffSignIn('delta-demo', 'admin@delta.example.test', '+919700000001');
    const deltaList = await api()
      .get('/api/v1/support-access-requests')
      .set('Authorization', bearer(deltaAdmin))
      .expect(200);
    expect(deltaList.body).toEqual([]);
    await api()
      .post(`/api/v1/support-access-requests/${requestId}/approve`)
      .set('Authorization', bearer(deltaAdmin))
      .expect(404);

    adminToken = await staffSignIn('gamma-demo', 'admin@gamma.example.test', '+919600000001');
    const list = await api()
      .get('/api/v1/support-access-requests')
      .set('Authorization', bearer(adminToken))
      .expect(200);
    expect(list.body[0]).toMatchObject({
      id: requestId,
      status: 'REQUESTED',
      requesterName: 'Synthetic superA',
      reason: REASON,
    });

    const approved = await api()
      .post(`/api/v1/support-access-requests/${requestId}/approve`)
      .set('Authorization', bearer(adminToken))
      .expect(200);
    expect(approved.body).toMatchObject({
      status: 'APPROVED',
      active: true,
      decidedByUserId: ids.gammaAdmin,
    });
    const window =
      new Date(approved.body.approvedUntil).getTime() - new Date(approved.body.decidedAt).getTime();
    expect(window).toBe(30 * 60_000);
  });

  it('another Super Admin cannot use someone else’s approval', async () => {
    // superB already used this window's code earlier in the suite (replay protection).
    const superB = await superAdminSignIn('superB', 'super.b@platform.example.test', 1);
    await api()
      .post(`/api/v1/platform/support-access/${requestId}/token`)
      .set('Authorization', bearer(superB))
      .expect(403);
  });

  it('the approved Super Admin gets read-only access to that hospital only', async () => {
    const issued = await api()
      .post(`/api/v1/platform/support-access/${requestId}/token`)
      .set('Authorization', bearer(ids.superAToken!))
      .expect(200);
    expect(issued.body.tenantId).toBe(ids.gamma);
    supportToken = issued.body.accessToken;

    const branches = await api()
      .get('/api/v1/branches')
      .set('Authorization', bearer(supportToken))
      .expect(200);
    expect(branches.body.map((b: { code: string }) => b.code)).toEqual(['MAIN', 'OLD']);
    await api().get('/api/v1/audit-events').set('Authorization', bearer(supportToken)).expect(200);

    // Not read-only data, or not permission-guarded: refused.
    await api()
      .get('/api/v1/support-access-requests')
      .set('Authorization', bearer(supportToken))
      .expect(403);
    await api()
      .post(`/api/v1/support-access-requests/${requestId}/revoke`)
      .set('Authorization', bearer(supportToken))
      .expect(403);
    await api().get('/api/v1/auth/me').set('Authorization', bearer(supportToken)).expect(403);
    await api()
      .get('/api/v1/platform/tenants')
      .set('Authorization', bearer(supportToken))
      .expect(401);
  });

  it('every use is recorded in the hospital’s own audit log', async () => {
    const events = await withTenant(db, ids.gamma!, (tx) =>
      tx.auditEvent.findMany({ where: { action: 'SUPPORT_ACCESS_USED', targetId: requestId } }),
    );
    const operations = events.map((e) => (e.metadata as { operation: string }).operation);
    expect(operations).toEqual(
      expect.arrayContaining(['GET /api/v1/branches', 'GET /api/v1/audit-events']),
    );
    expect(
      events.every((e) => (e.metadata as { platformUserId: string }).platformUserId === ids.superA),
    ).toBe(true);

    const approvals = await withTenant(db, ids.gamma!, (tx) =>
      tx.auditEvent.count({
        where: { action: 'SUPPORT_ACCESS_APPROVED', actorUserId: ids.gammaAdmin },
      }),
    );
    expect(approvals).toBe(1);
  });

  it('revoking ends access immediately and cannot be undone', async () => {
    const revoked = await api()
      .post(`/api/v1/support-access-requests/${requestId}/revoke`)
      .set('Authorization', bearer(adminToken))
      .expect(200);
    expect(revoked.body).toMatchObject({ status: 'REVOKED', active: false });

    await api().get('/api/v1/branches').set('Authorization', bearer(supportToken)).expect(401);
    await api()
      .post(`/api/v1/platform/support-access/${requestId}/token`)
      .set('Authorization', bearer(ids.superAToken!))
      .expect(403);
    await api()
      .post(`/api/v1/support-access-requests/${requestId}/approve`)
      .set('Authorization', bearer(adminToken))
      .expect(404);
  });

  it('the platform audit log records the Super Admin side', async () => {
    const actions = (
      await platform.platformAuditEvent.findMany({ where: { actorPlatformUserId: ids.superA } })
    ).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'PLATFORM_LOGIN_TOTP',
        'SUPPORT_ACCESS_REQUESTED',
        'SUPPORT_ACCESS_TOKEN_ISSUED',
      ]),
    );
  });
});
