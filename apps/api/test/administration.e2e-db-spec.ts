/**
 * ADR-0004 end to end: onboarding a hospital, first-admin invitation, staff invitations,
 * branches and staff within plan limits, staff management, settings, plan changes and
 * suspension. Real NestJS app, real PostgreSQL with RLS. All data is synthetic.
 */
import { type PrismaClient, createPrismaClient } from '@kenisha/database';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { loadSecretBoxKey, sealSecret } from '../src/auth/crypto/secret-box';
import { generateTotpSecret, totpCodeForStep, totpStep } from '../src/auth/crypto/totp';
import { hashPassword } from '../src/auth/password/password-hasher';
import { SMS_PROVIDER } from '../src/auth/sms/sms.provider';
import { configureApp } from '../src/bootstrap/configure-app';
import type { Env } from '../src/config/env.validation';
import { CapturingSms } from './support/capturing-sms';

const PASSWORD = 'Monsoon-Ledger-47-Banyan';
const HOSPITAL = 'omega-demo';
const PHONES = {
  admin: '+919110000001',
  doctor: '+919110000002',
  nurse: '+919110000003',
  pharmacist: '+919110000004',
  extra: '+919110000005',
};

let app: INestApplication<App>;
let sms: CapturingSms;
let platform: PrismaClient;
let superToken: string;
let tenantId: string;
let adminToken: string;
const ids: Record<string, string> = {};

const api = () => request(app.getHttpServer());
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function staffSignIn(identifier: string, phone: string): Promise<string> {
  const first = await api()
    .post('/api/v1/auth/staff/login')
    .send({ hospitalCode: HOSPITAL, identifier, password: PASSWORD, client: 'mobile' })
    .expect(200);
  if (first.body.status === 'AUTHENTICATED') {
    return first.body.tokens.accessToken as string;
  }
  const verified = await api()
    .post('/api/v1/auth/staff/mfa/verify')
    .send({
      hospitalCode: HOSPITAL,
      challengeId: first.body.challengeId,
      code: sms.lastCodeFor(phone),
      client: 'mobile',
    })
    .expect(200);
  return verified.body.accessToken as string;
}

function acceptInvitation(phone: string, password = PASSWORD) {
  const { hospitalCode, token } = sms.lastInvitationFor(phone);
  return api().post('/api/v1/auth/invitations/accept').send({ hospitalCode, token, password });
}

beforeAll(async () => {
  platform = createPrismaClient(process.env.KENISHA_E2E_PLATFORM_URL!, { maxConnections: 2 });
  for (const plan of [
    {
      code: 'E2E_SMALL',
      name: 'Small',
      includedModules: ['HOSPITAL' as const],
      maxBranches: 2,
      maxStaffUsers: 3,
    },
    {
      code: 'E2E_BIG',
      name: 'Big',
      includedModules: ['HOSPITAL' as const, 'MATERNAL' as const],
      maxBranches: 10,
      maxStaffUsers: 50,
    },
  ]) {
    await platform.subscriptionPlan.create({ data: plan });
  }

  const secret = generateTotpSecret();
  await platform.platformUser.create({
    data: {
      email: 'admin.ops@platform.example.test',
      displayName: 'Synthetic Ops',
      passwordHash: await hashPassword(PASSWORD),
      totpSecretEncrypted: sealSecret(secret, loadSecretBoxKey(process.env.PLATFORM_TOTP_KEY!)),
    },
  });

  sms = new CapturingSms();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SMS_PROVIDER)
    .useValue(sms)
    .compile();
  app = moduleRef.createNestApplication();
  configureApp(app, app.get<ConfigService<Env, true>>(ConfigService));
  await app.init();

  const step1 = await api()
    .post('/api/v1/platform/auth/login')
    .send({ email: 'admin.ops@platform.example.test', password: PASSWORD })
    .expect(200);
  const step2 = await api()
    .post('/api/v1/platform/auth/totp/verify')
    .send({ mfaToken: step1.body.mfaToken, code: totpCodeForStep(secret, totpStep(new Date())) })
    .expect(200);
  superToken = step2.body.accessToken;
});

afterAll(async () => {
  await app?.close();
  await platform?.$disconnect();
});

describe('onboarding a hospital', () => {
  it('creates the hospital in ONBOARDING and SMS-invites its first admin', async () => {
    const created = await api()
      .post('/api/v1/platform/tenants')
      .set(bearer(superToken))
      .send({
        code: HOSPITAL,
        name: 'Omega Demo Hospital',
        planCode: 'E2E_SMALL',
        adminName: 'Synthetic Omega Admin',
        adminPhone: PHONES.admin,
        adminEmail: 'admin@omega.example.test',
      })
      .expect(201);
    expect(created.body).toMatchObject({ code: HOSPITAL, status: 'ONBOARDING' });
    tenantId = created.body.tenantId;

    const { hospitalCode, token } = sms.lastInvitationFor(PHONES.admin);
    expect(hospitalCode).toBe(HOSPITAL);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    await api()
      .post('/api/v1/platform/tenants')
      .set(bearer(superToken))
      .send({
        code: HOSPITAL,
        name: 'Dup',
        planCode: 'E2E_SMALL',
        adminName: 'x y',
        adminPhone: PHONES.extra,
      })
      .expect(409);
  });

  it('blocks logins until the first admin has accepted', async () => {
    await api()
      .post('/api/v1/auth/staff/login')
      .send({
        hospitalCode: HOSPITAL,
        identifier: 'admin@omega.example.test',
        password: PASSWORD,
        client: 'mobile',
      })
      .expect(401);
  });

  it('shows the invitee who the invitation is for, with the phone masked', async () => {
    const { hospitalCode, token } = sms.lastInvitationFor(PHONES.admin);
    const preview = await api()
      .post('/api/v1/auth/invitations/inspect')
      .send({ hospitalCode, token })
      .expect(200);
    expect(preview.body).toMatchObject({
      hospitalName: 'Omega Demo Hospital',
      displayName: 'Synthetic Omega Admin',
      roles: ['HOSPITAL_ADMIN'],
      phone: '******0001',
    });
  });

  it('rejects a weak password, then activates the account and the hospital', async () => {
    const weak = await acceptInvitation(PHONES.admin, 'password1234').expect(400);
    expect(weak.body.message).toMatch(/too common/);

    await acceptInvitation(PHONES.admin).expect(200);
    await acceptInvitation(PHONES.admin).expect(404); // single use

    const detail = await api()
      .get(`/api/v1/platform/tenants/${tenantId}`)
      .set(bearer(superToken))
      .expect(200);
    expect(detail.body.status).toBe('ACTIVE');
    expect(detail.body.adminInvitations[0].status).toBe('ACCEPTED');
    expect(JSON.stringify(detail.body)).not.toMatch(/token|admin@omega|\+9191/);

    adminToken = await staffSignIn('admin@omega.example.test', PHONES.admin);
    const me = await api().get('/api/v1/auth/me').set(bearer(adminToken)).expect(200);
    expect(me.body).toMatchObject({ roles: ['HOSPITAL_ADMIN'], enabledModules: ['HOSPITAL'] });
  });
});

describe('branches within the plan', () => {
  it('enforces unique codes and the branch limit', async () => {
    ids.main = (
      await api()
        .post('/api/v1/branches')
        .set(bearer(adminToken))
        .send({ code: 'MAIN', name: 'Main', city: 'Kozhikode', state: 'Kerala' })
        .expect(201)
    ).body.id;
    await api()
      .post('/api/v1/branches')
      .set(bearer(adminToken))
      .send({ code: 'MAIN', name: 'Again', city: 'Kochi', state: 'Kerala' })
      .expect(409);
    ids.north = (
      await api()
        .post('/api/v1/branches')
        .set(bearer(adminToken))
        .send({ code: 'NORTH', name: 'North', city: 'Kozhikode', state: 'Kerala' })
        .expect(201)
    ).body.id;

    const third = await api()
      .post('/api/v1/branches')
      .set(bearer(adminToken))
      .send({ code: 'SOUTH', name: 'South', city: 'Kozhikode', state: 'Kerala' })
      .expect(409);
    expect(third.body.message).toMatch(/allows 2 active branch/);
  });

  it('frees a slot on deactivation and re-checks the plan on reactivation', async () => {
    await api()
      .post(`/api/v1/branches/${ids.north}/deactivate`)
      .set(bearer(adminToken))
      .expect(200);
    await api()
      .post('/api/v1/branches')
      .set(bearer(adminToken))
      .send({ code: 'SOUTH', name: 'South', city: 'Kozhikode', state: 'Kerala' })
      .expect(201);
    await api()
      .post(`/api/v1/branches/${ids.north}/reactivate`)
      .set(bearer(adminToken))
      .expect(409);
  });
});

describe('staff invitations', () => {
  it('invites staff, refuses duplicates and stops at the staff limit', async () => {
    const doctor = await api()
      .post('/api/v1/staff-invitations')
      .set(bearer(adminToken))
      .send({
        displayName: 'Synthetic Doctor',
        phone: PHONES.doctor,
        email: 'doctor@omega.example.test',
        roles: ['DOCTOR'],
        branchIds: [ids.main],
      })
      .expect(201);
    expect(doctor.body).toMatchObject({ status: 'PENDING', invitedBy: 'HOSPITAL' });

    await api()
      .post('/api/v1/staff-invitations')
      .set(bearer(adminToken))
      .send({ displayName: 'Dup', phone: PHONES.doctor, roles: ['NURSE'], branchIds: [] })
      .expect(409);

    ids.nurseInvite = (
      await api()
        .post('/api/v1/staff-invitations')
        .set(bearer(adminToken))
        .send({
          displayName: 'Synthetic Nurse',
          phone: PHONES.nurse,
          roles: ['NURSE'],
          branchIds: [],
        })
        .expect(201)
    ).body.id;

    // 1 admin + 2 pending invitations = 3 = the plan maximum.
    const full = await api()
      .post('/api/v1/staff-invitations')
      .set(bearer(adminToken))
      .send({
        displayName: 'Synthetic Pharmacist',
        phone: PHONES.pharmacist,
        roles: ['PHARMACIST'],
        branchIds: [],
      })
      .expect(409);
    expect(full.body.message).toMatch(/allows 3 staff accounts/);
  });

  it('cannot invite patients through the staff flow', async () => {
    await api()
      .post('/api/v1/staff-invitations')
      .set(bearer(adminToken))
      .send({ displayName: 'P', phone: PHONES.extra, roles: ['PATIENT'], branchIds: [] })
      .expect(400);
  });

  it('a revoked invitation can no longer be accepted, and frees its slot', async () => {
    await api()
      .post(`/api/v1/staff-invitations/${ids.nurseInvite}/revoke`)
      .set(bearer(adminToken))
      .expect(200);
    await acceptInvitation(PHONES.nurse).expect(404);
    await api()
      .post('/api/v1/staff-invitations')
      .set(bearer(adminToken))
      .send({
        displayName: 'Synthetic Pharmacist',
        phone: PHONES.pharmacist,
        roles: ['PHARMACIST'],
        branchIds: [],
      })
      .expect(201);
  });

  it('resending invalidates the previous link', async () => {
    const first = sms.lastInvitationFor(PHONES.pharmacist);
    const list = await api().get('/api/v1/staff-invitations').set(bearer(adminToken)).expect(200);
    const invite = list.body.find(
      (i: { phoneE164: string; status: string }) =>
        i.phoneE164 === PHONES.pharmacist && i.status === 'PENDING',
    );
    await api()
      .post(`/api/v1/staff-invitations/${invite.id}/resend`)
      .set(bearer(adminToken))
      .expect(200);

    await api().post('/api/v1/auth/invitations/inspect').send(first).expect(404);
    await acceptInvitation(PHONES.pharmacist).expect(200);
  });

  it('the accepted doctor gets the invited roles and branches', async () => {
    await acceptInvitation(PHONES.doctor).expect(200);
    const staff = await api().get('/api/v1/staff').set(bearer(adminToken)).expect(200);
    const doctor = staff.body.find((s: { phoneE164: string }) => s.phoneE164 === PHONES.doctor);
    expect(doctor).toMatchObject({
      roles: ['DOCTOR'],
      branchIds: [ids.main],
      status: 'ACTIVE',
      locked: false,
    });
    ids.doctor = doctor.userId;
  });
});

describe('staff management and settings', () => {
  it('only staff:manage holders can change staff; nobody can change themself', async () => {
    const doctorToken = await staffSignIn('doctor@omega.example.test', PHONES.doctor);
    await api().get('/api/v1/staff').set(bearer(doctorToken)).expect(403);
    await api()
      .post('/api/v1/staff-invitations')
      .set(bearer(doctorToken))
      .send({ displayName: 'x y', phone: PHONES.extra, roles: ['NURSE'], branchIds: [] })
      .expect(403);

    const me = await api().get('/api/v1/auth/me').set(bearer(adminToken)).expect(200);
    await api().post(`/api/v1/staff/${me.body.userId}/disable`).set(bearer(adminToken)).expect(403);
  });

  it('branch scope follows the hospital setting', async () => {
    await api()
      .patch('/api/v1/tenant')
      .set(bearer(adminToken))
      .send({ branchScopeMode: 'ASSIGNED_BRANCHES' })
      .expect(200);
    const doctorToken = await staffSignIn('doctor@omega.example.test', PHONES.doctor);
    const branches = await api().get('/api/v1/branches').set(bearer(doctorToken)).expect(200);
    expect(branches.body.map((b: { code: string }) => b.code)).toEqual(['MAIN']);
  });

  it('changing roles ends the person’s sessions immediately', async () => {
    const doctorToken = await staffSignIn('doctor@omega.example.test', PHONES.doctor);
    await api()
      .put(`/api/v1/staff/${ids.doctor}/roles`)
      .set(bearer(adminToken))
      .send({ roles: ['DOCTOR', 'NURSE'] })
      .expect(200);
    await api().get('/api/v1/auth/me').set(bearer(doctorToken)).expect(401);
  });

  it('disabling blocks login; re-enabling is checked against the plan', async () => {
    await api().post(`/api/v1/staff/${ids.doctor}/disable`).set(bearer(adminToken)).expect(200);
    await api()
      .post('/api/v1/auth/staff/login')
      .send({
        hospitalCode: HOSPITAL,
        identifier: 'doctor@omega.example.test',
        password: PASSWORD,
        client: 'mobile',
      })
      .expect(401);

    // Fill the freed slot, so re-enabling would exceed the plan.
    await api()
      .post('/api/v1/staff-invitations')
      .set(bearer(adminToken))
      .send({
        displayName: 'Synthetic Extra',
        phone: PHONES.extra,
        roles: ['NURSE'],
        branchIds: [],
      })
      .expect(201);
    await api().post(`/api/v1/staff/${ids.doctor}/enable`).set(bearer(adminToken)).expect(409);
  });

  it('an admin can unlock a locked account', async () => {
    const wrong = () =>
      api().post('/api/v1/auth/staff/login').send({
        hospitalCode: HOSPITAL,
        identifier: PHONES.pharmacist,
        password: 'Wrong-Password-123',
        client: 'mobile',
      });
    for (let i = 0; i < 5; i += 1) await wrong().expect(401);
    await api()
      .post('/api/v1/auth/staff/login')
      .send({
        hospitalCode: HOSPITAL,
        identifier: PHONES.pharmacist,
        password: PASSWORD,
        client: 'mobile',
      })
      .expect(401);

    const staff = await api().get('/api/v1/staff').set(bearer(adminToken)).expect(200);
    const pharmacist = staff.body.find(
      (s: { phoneE164: string }) => s.phoneE164 === PHONES.pharmacist,
    );
    expect(pharmacist.locked).toBe(true);
    await api()
      .post(`/api/v1/staff/${pharmacist.userId}/unlock`)
      .set(bearer(adminToken))
      .expect(200);
    await staffSignIn(PHONES.pharmacist, PHONES.pharmacist);
  });

  it('the SMS-factor setting applies to non-admin staff only', async () => {
    await api()
      .patch('/api/v1/tenant')
      .set(bearer(adminToken))
      .send({ staffMfaMode: 'ADMINS_ONLY' })
      .expect(200);
    const pharmacist = await api()
      .post('/api/v1/auth/staff/login')
      .send({
        hospitalCode: HOSPITAL,
        identifier: PHONES.pharmacist,
        password: PASSWORD,
        client: 'mobile',
      })
      .expect(200);
    expect(pharmacist.body.status).toBe('AUTHENTICATED');
    const admin = await api()
      .post('/api/v1/auth/staff/login')
      .send({
        hospitalCode: HOSPITAL,
        identifier: PHONES.admin,
        password: PASSWORD,
        client: 'mobile',
      })
      .expect(200);
    expect(admin.body.status).toBe('MFA_REQUIRED');
  });
});

describe('platform administration', () => {
  it('lists hospitals with usage counts only', async () => {
    const list = await api().get('/api/v1/platform/tenants').set(bearer(superToken)).expect(200);
    const omega = list.body.find((t: { code: string }) => t.code === HOSPITAL);
    expect(omega).toMatchObject({
      status: 'ACTIVE',
      plan: { code: 'E2E_SMALL' },
      usage: { activeBranches: 2, activeStaff: 2, pendingInvitations: 1 },
    });
    expect(JSON.stringify(list.body)).not.toMatch(/Synthetic Doctor|\+9191|omega\.example/);
  });

  it('a plan change takes effect for the hospital immediately', async () => {
    await api()
      .put(`/api/v1/platform/tenants/${tenantId}/plan`)
      .set(bearer(superToken))
      .send({ planCode: 'E2E_BIG' })
      .expect(200);
    const overview = await api().get('/api/v1/tenant').set(bearer(adminToken)).expect(200);
    expect(overview.body.plan).toMatchObject({
      code: 'E2E_BIG',
      maxStaffUsers: 50,
      enabledModules: ['HOSPITAL', 'MATERNAL'],
    });
    await api().post(`/api/v1/staff/${ids.doctor}/enable`).set(bearer(adminToken)).expect(200);
  });

  it('suspension ends every session at once; reactivation restores access', async () => {
    await api()
      .post(`/api/v1/platform/tenants/${tenantId}/suspend`)
      .set(bearer(superToken))
      .expect(200);
    await api().get('/api/v1/auth/me').set(bearer(adminToken)).expect(401);
    await api()
      .post('/api/v1/auth/staff/login')
      .send({
        hospitalCode: HOSPITAL,
        identifier: PHONES.admin,
        password: PASSWORD,
        client: 'mobile',
      })
      .expect(401);

    await api()
      .post(`/api/v1/platform/tenants/${tenantId}/reactivate`)
      .set(bearer(superToken))
      .expect(200);
    adminToken = await staffSignIn(PHONES.admin, PHONES.admin);
  });

  it('keeps platform and hospital tokens apart', async () => {
    await api().get('/api/v1/staff').set(bearer(superToken)).expect(401);
    await api().get('/api/v1/platform/tenants').set(bearer(adminToken)).expect(401);
  });

  it('records every administrative action in the hospital audit log', async () => {
    const events = await api().get('/api/v1/audit-events').set(bearer(adminToken)).expect(200);
    const actions = new Set(events.body.map((e: { action: string }) => e.action));
    for (const action of [
      'STAFF_INVITATION_ACCEPTED',
      'BRANCH_CREATED',
      'BRANCH_DEACTIVATED',
      'STAFF_INVITED',
      'STAFF_INVITATION_REVOKED',
      'STAFF_INVITATION_RESENT',
      'STAFF_ROLES_CHANGED',
      'STAFF_DISABLED',
      'STAFF_UNLOCKED',
      'STAFF_ENABLED',
      'TENANT_SETTINGS_CHANGED',
    ]) {
      expect(actions).toContain(action);
    }
  });
});
