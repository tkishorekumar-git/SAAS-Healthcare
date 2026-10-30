/**
 * ADR-0003 login flows end to end: real NestJS app, real PostgreSQL with RLS, connected
 * as kenisha_app. SMS delivery is captured instead of sent. All data is synthetic.
 */
import { type PrismaClient, createPrismaClient, withTenant } from '@kenisha/database';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { hashPassword } from '../src/auth/password/password-hasher';
import { SMS_PROVIDER } from '../src/auth/sms/sms.provider';
import { configureApp } from '../src/bootstrap/configure-app';
import type { Env } from '../src/config/env.validation';
import { CapturingSms } from './support/capturing-sms';

const PASSWORD = 'Monsoon-Ledger-47-Banyan';

let app: INestApplication<App>;
let sms: CapturingSms;
let platform: PrismaClient;
let db: PrismaClient;
const ids: Record<string, string> = {};

const api = () => request(app.getHttpServer());

async function createUser(
  tenantId: string,
  key: string,
  data: {
    kind: 'STAFF' | 'PERSONAL';
    phone: string;
    email?: string;
    roles: Array<'HOSPITAL_ADMIN' | 'DOCTOR' | 'NURSE' | 'PATIENT' | 'PARENT_GUARDIAN'>;
    branchIds?: string[];
  },
): Promise<void> {
  const passwordHash = data.kind === 'STAFF' ? await hashPassword(PASSWORD) : null;
  ids[key] = await withTenant(db, tenantId, async (tx) => {
    const user = await tx.user.create({
      data: {
        tenantId,
        accountKind: data.kind,
        displayName: `Synthetic ${key}`,
        phoneE164: data.phone,
        email: data.email ?? null,
        roles: { create: data.roles.map((role) => ({ role })) },
      },
    });
    if (passwordHash) {
      await tx.passwordCredential.create({ data: { tenantId, userId: user.id, passwordHash } });
    }
    for (const branchId of data.branchIds ?? []) {
      await tx.staffBranchAssignment.create({ data: { tenantId, userId: user.id, branchId } });
    }
    return user.id;
  });
}

function staffLogin(hospitalCode: string, identifier: string, client: 'web' | 'mobile' = 'mobile') {
  return api()
    .post('/api/v1/auth/staff/login')
    .send({ hospitalCode, identifier, password: PASSWORD, client });
}

/** Full staff login including the SMS factor; returns the token response. */
async function staffSignIn(hospitalCode: string, identifier: string, phone: string) {
  const first = await staffLogin(hospitalCode, identifier).expect(200);
  if (first.body.status === 'AUTHENTICATED') {
    return first.body.tokens as { accessToken: string; refreshToken: string };
  }
  const verified = await api()
    .post('/api/v1/auth/staff/mfa/verify')
    .send({
      hospitalCode,
      challengeId: first.body.challengeId,
      code: sms.lastCodeFor(phone),
      client: 'mobile',
    })
    .expect(200);
  return verified.body as { accessToken: string; refreshToken: string };
}

async function patientSignIn(hospitalCode: string, phone: string) {
  const requested = await api()
    .post('/api/v1/auth/otp/request')
    .send({ hospitalCode, phone })
    .expect(202);
  const verified = await api()
    .post('/api/v1/auth/otp/verify')
    .send({
      hospitalCode,
      challengeId: requested.body.challengeId,
      code: sms.lastCodeFor(phone),
      client: 'mobile',
    })
    .expect(200);
  return verified.body as { accessToken: string; refreshToken: string };
}

beforeAll(async () => {
  platform = createPrismaClient(process.env.KENISHA_E2E_PLATFORM_URL!, { maxConnections: 2 });
  db = createPrismaClient(process.env.KENISHA_E2E_APP_URL!, { maxConnections: 2 });

  // alpha: SMS factor for all staff, staff restricted to assigned branches.
  const alpha = await platform.tenant.create({
    data: {
      slug: 'alpha-demo',
      name: 'Alpha Demo Hospital',
      status: 'ACTIVE',
      branchScopeMode: 'ASSIGNED_BRANCHES',
    },
  });
  // beta: SMS factor for admins only.
  const beta = await platform.tenant.create({
    data: {
      slug: 'beta-demo',
      name: 'Beta Demo Clinic',
      status: 'ACTIVE',
      staffMfaMode: 'ADMINS_ONLY',
    },
  });
  await platform.tenant.create({
    data: { slug: 'gamma-suspended', name: 'Gamma', status: 'SUSPENDED' },
  });
  ids.alpha = alpha.id;
  ids.beta = beta.id;

  await withTenant(db, alpha.id, async (tx) => {
    ids.alphaMain = (
      await tx.branch.create({
        data: { tenantId: alpha.id, code: 'MAIN', name: 'Main', city: 'Kochi', state: 'KL' },
      })
    ).id;
    ids.alphaNorth = (
      await tx.branch.create({
        data: { tenantId: alpha.id, code: 'NORTH', name: 'North', city: 'Kochi', state: 'KL' },
      })
    ).id;
    ids.alphaClosed = (
      await tx.branch.create({
        data: {
          tenantId: alpha.id,
          code: 'OLD',
          name: 'Old',
          city: 'Kochi',
          state: 'KL',
          isActive: false,
        },
      })
    ).id;
  });

  await createUser(alpha.id, 'alphaAdmin', {
    kind: 'STAFF',
    phone: '+919100000001',
    email: 'admin@alpha.example.test',
    roles: ['HOSPITAL_ADMIN'],
  });
  await createUser(alpha.id, 'alphaDoctor', {
    kind: 'STAFF',
    phone: '+919100000002',
    email: 'doctor@alpha.example.test',
    roles: ['DOCTOR'],
    branchIds: [ids.alphaNorth!],
  });
  await createUser(alpha.id, 'alphaLockme', {
    kind: 'STAFF',
    phone: '+919100000003',
    email: 'lockme@alpha.example.test',
    roles: ['NURSE'],
  });
  await createUser(alpha.id, 'alphaPatient', {
    kind: 'PERSONAL',
    phone: '+919200000001',
    roles: ['PATIENT', 'PARENT_GUARDIAN'],
  });
  await createUser(alpha.id, 'alphaPatient2', {
    kind: 'PERSONAL',
    phone: '+919200000002',
    roles: ['PATIENT'],
  });
  await createUser(alpha.id, 'alphaPatient3', {
    kind: 'PERSONAL',
    phone: '+919200000003',
    roles: ['PATIENT'],
  });
  await createUser(alpha.id, 'alphaPatient4', {
    kind: 'PERSONAL',
    phone: '+919200000004',
    roles: ['PATIENT'],
  });
  await createUser(beta.id, 'betaAdmin', {
    kind: 'STAFF',
    phone: '+919300000001',
    email: 'admin@beta.example.test',
    roles: ['HOSPITAL_ADMIN'],
  });
  await createUser(beta.id, 'betaNurse', {
    kind: 'STAFF',
    phone: '+919300000002',
    email: 'nurse@beta.example.test',
    roles: ['NURSE'],
  });

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

describe('patient / guardian login with an SMS code', () => {
  it('signs in, returns the profile and shows only active branches', async () => {
    const tokens = await patientSignIn('alpha-demo', '+919200000001');
    expect(tokens.refreshToken).toMatch(/^rt1\./);

    const me = await api()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({ userId: ids.alphaPatient, accountKind: 'PERSONAL' });
    expect(me.body.roles.sort()).toEqual(['PARENT_GUARDIAN', 'PATIENT']);
    expect(me.body.permissions).not.toContain('audit:read');

    const branches = await api()
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);
    expect(branches.body.map((b: { code: string }) => b.code)).toEqual(['MAIN', 'NORTH']);
  });

  it('answers identically for an unregistered number and sends no SMS', async () => {
    const before = sms.sent.length;
    const response = await api()
      .post('/api/v1/auth/otp/request')
      .send({ hospitalCode: 'alpha-demo', phone: '+919299999999' })
      .expect(202);
    expect(Object.keys(response.body).sort()).toEqual(['challengeId', 'expiresInSeconds']);
    expect(sms.sent.length).toBe(before);

    await api()
      .post('/api/v1/auth/otp/verify')
      .send({
        hospitalCode: 'alpha-demo',
        challengeId: response.body.challengeId,
        code: '000000',
        client: 'mobile',
      })
      .expect(401);
  });

  it('answers identically for unknown or suspended hospitals', async () => {
    for (const hospitalCode of ['no-such-hospital', 'gamma-suspended']) {
      const response = await api()
        .post('/api/v1/auth/otp/request')
        .send({ hospitalCode, phone: '+919200000001' })
        .expect(202);
      expect(Object.keys(response.body).sort()).toEqual(['challengeId', 'expiresInSeconds']);
    }
  });

  it('enforces a resend cooldown per number', async () => {
    await api()
      .post('/api/v1/auth/otp/request')
      .send({ hospitalCode: 'alpha-demo', phone: '+919200000002' })
      .expect(202);
    await api()
      .post('/api/v1/auth/otp/request')
      .send({ hospitalCode: 'alpha-demo', phone: '+919200000002' })
      .expect(429);
  });

  it('locks a code after 5 wrong attempts, even if the right code follows', async () => {
    const { body } = await api()
      .post('/api/v1/auth/otp/request')
      .send({ hospitalCode: 'alpha-demo', phone: '+919200000003' })
      .expect(202);
    const correct = sms.lastCodeFor('+919200000003');
    const wrong = correct === '000000' ? '111111' : '000000';
    const attempt = (code: string) =>
      api().post('/api/v1/auth/otp/verify').send({
        hospitalCode: 'alpha-demo',
        challengeId: body.challengeId,
        code,
        client: 'mobile',
      });

    for (let i = 0; i < 5; i += 1) await attempt(wrong).expect(401);
    await attempt(correct).expect(401);
  });

  it('does not let a staff phone number log in with an SMS code alone', async () => {
    const before = sms.sent.length;
    await api()
      .post('/api/v1/auth/otp/request')
      .send({ hospitalCode: 'alpha-demo', phone: '+919100000002' })
      .expect(202);
    expect(sms.sent.length).toBe(before);
  });
});

describe('staff login with password and SMS factor', () => {
  it('rejects a wrong password with a generic message', async () => {
    const response = await api()
      .post('/api/v1/auth/staff/login')
      .send({
        hospitalCode: 'alpha-demo',
        identifier: 'doctor@alpha.example.test',
        password: 'Wrong-Password-123',
        client: 'web',
      })
      .expect(401);
    expect(response.body.message).toBe('Invalid hospital code or login details.');
  });

  it('requires the SMS code, then issues a web session with an HttpOnly cookie', async () => {
    const first = await staffLogin('alpha-demo', 'doctor@alpha.example.test', 'web').expect(200);
    expect(first.body).toMatchObject({ status: 'MFA_REQUIRED' });
    expect(first.body.tokens).toBeUndefined();

    const verified = await api()
      .post('/api/v1/auth/staff/mfa/verify')
      .send({
        hospitalCode: 'alpha-demo',
        challengeId: first.body.challengeId,
        code: sms.lastCodeFor('+919100000002'),
        client: 'web',
      })
      .expect(200);

    expect(verified.body.refreshToken).toBeUndefined();
    const cookie = String(verified.headers['set-cookie']);
    expect(cookie).toMatch(/kenisha_rt=rt1\./);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);

    // The browser sends the cookie back to refresh.
    const refreshed = await api()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie.split(';')[0]!)
      .send({})
      .expect(200);
    expect(refreshed.body.accessToken).toBeTruthy();
  });

  it('accepts a phone number as the identifier', async () => {
    const tokens = await staffSignIn('alpha-demo', '+91 91000 00002', '+919100000002');
    expect(tokens.accessToken).toBeTruthy();
  });

  it('skips the SMS factor for non-admin staff only when the hospital chose ADMINS_ONLY', async () => {
    const nurse = await staffLogin('beta-demo', 'nurse@beta.example.test').expect(200);
    expect(nurse.body.status).toBe('AUTHENTICATED');

    const admin = await staffLogin('beta-demo', 'admin@beta.example.test').expect(200);
    expect(admin.body.status).toBe('MFA_REQUIRED');
  });

  it('cannot log in to a different hospital', async () => {
    await staffLogin('beta-demo', 'doctor@alpha.example.test').expect(401);
  });

  it('locks the account after 5 wrong passwords, even for the right password', async () => {
    const wrong = () =>
      api().post('/api/v1/auth/staff/login').send({
        hospitalCode: 'alpha-demo',
        identifier: 'lockme@alpha.example.test',
        password: 'Wrong-Password-123',
        client: 'mobile',
      });
    for (let i = 0; i < 5; i += 1) await wrong().expect(401);
    await staffLogin('alpha-demo', 'lockme@alpha.example.test').expect(401);
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and revokes the session when an old one is replayed', async () => {
    // Own patient: each number may request a code only once per minute.
    const first = await patientSignIn('alpha-demo', '+919200000004');

    const second = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    expect(second.body.refreshToken).not.toBe(first.refreshToken);

    // Replaying the first (already used) token is treated as theft.
    await api().post('/api/v1/auth/refresh').send({ refreshToken: first.refreshToken }).expect(401);

    // The whole session is now dead: the newest tokens stop working immediately.
    await api()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${second.body.accessToken}`)
      .expect(401);
    await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: second.body.refreshToken })
      .expect(401);
  });

  it('logout revokes the access token immediately', async () => {
    const tokens = await staffSignIn('beta-demo', 'nurse@beta.example.test', '+919300000002');
    const auth = `Bearer ${tokens.accessToken}`;
    await api().get('/api/v1/auth/me').set('Authorization', auth).expect(200);
    await api().post('/api/v1/auth/logout').set('Authorization', auth).expect(204);
    await api().get('/api/v1/auth/me').set('Authorization', auth).expect(401);
  });

  it('disabling a user ends their sessions', async () => {
    const tokens = await staffSignIn('beta-demo', 'nurse@beta.example.test', '+919300000002');
    await withTenant(db, ids.beta!, (tx) =>
      tx.user.update({ where: { id: ids.betaNurse }, data: { status: 'DISABLED' } }),
    );
    await api()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(401);
    await withTenant(db, ids.beta!, (tx) =>
      tx.user.update({ where: { id: ids.betaNurse }, data: { status: 'ACTIVE' } }),
    );
  });
});

describe('permissions and branch scope', () => {
  it('restricts staff to assigned branches in ASSIGNED_BRANCHES mode', async () => {
    const doctor = await staffSignIn('alpha-demo', 'doctor@alpha.example.test', '+919100000002');
    const branches = await api()
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .expect(200);
    expect(branches.body.map((b: { id: string }) => b.id)).toEqual([ids.alphaNorth]);
  });

  it('lets Hospital Admin see every branch, including inactive ones', async () => {
    const admin = await staffSignIn('alpha-demo', 'admin@alpha.example.test', '+919100000001');
    const branches = await api()
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(branches.body.map((b: { code: string }) => b.code)).toEqual(['MAIN', 'NORTH', 'OLD']);
  });

  it('allows only admins to read the audit log, which records logins without secrets', async () => {
    const doctor = await staffSignIn('alpha-demo', 'doctor@alpha.example.test', '+919100000002');
    await api()
      .get('/api/v1/audit-events')
      .set('Authorization', `Bearer ${doctor.accessToken}`)
      .expect(403);

    const admin = await staffSignIn('alpha-demo', 'admin@alpha.example.test', '+919100000001');
    const events = await api()
      .get('/api/v1/audit-events')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    const actions = new Set(events.body.map((e: { action: string }) => e.action));
    for (const action of [
      'AUTH_STAFF_LOGIN',
      'AUTH_OTP_LOGIN',
      'AUTH_STAFF_ACCOUNT_LOCKED',
      'AUTH_REFRESH_REUSE_DETECTED',
    ]) {
      expect(actions).toContain(action);
    }

    // Raw audit rows never contain codes, tokens or password material.
    const raw = await withTenant(db, ids.alpha!, (tx) => tx.auditEvent.findMany());
    const serialized = JSON.stringify(raw);
    expect(serialized).not.toMatch(/rt1\.|\$argon2|Monsoon/);
    for (const { code } of sms.sent) expect(serialized).not.toContain(`"${code}"`);
  });

  it('never shows another hospital’s audit events', async () => {
    const admin = await staffSignIn('beta-demo', 'admin@beta.example.test', '+919300000001');
    const events = await api()
      .get('/api/v1/audit-events')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    const alphaActors = new Set([ids.alphaAdmin, ids.alphaDoctor, ids.alphaPatient]);
    expect(events.body.some((e: { actorUserId: string }) => alphaActors.has(e.actorUserId))).toBe(
      false,
    );
  });
});
