import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { listRoutes } from '../src/auth/route-access';
import { configureApp } from '../src/bootstrap/configure-app';
import type { Env } from '../src/config/env.validation';

/**
 * The reviewed access decision for every API route (ADR-0005 section 1). Adding, removing or
 * changing the protection of a route fails this test until the table is updated, so every
 * change to the attack surface shows up in code review.
 */
const EXPECTED: Record<string, string> = {
  'GET /audit-events': 'permissions: audit:read',
  'GET /auth/me': 'self-service',
  'POST /auth/invitations/accept': 'public',
  'POST /auth/invitations/inspect': 'public',
  'POST /auth/logout': 'self-service',
  'POST /auth/logout-all': 'self-service',
  'POST /auth/otp/request': 'public',
  'POST /auth/otp/verify': 'public',
  'POST /auth/refresh': 'public',
  'POST /auth/staff/login': 'public',
  'POST /auth/staff/mfa/verify': 'public',
  'GET /branches': 'permissions: branch:read',
  'POST /branches': 'permissions: branch:manage',
  'PATCH /branches/:id': 'permissions: branch:manage',
  'POST /branches/:id/deactivate': 'permissions: branch:manage',
  'POST /branches/:id/reactivate': 'permissions: branch:manage',
  'GET /health': 'public',
  'GET /health/ready': 'public',
  'GET /platform/auth/me': 'platform',
  'POST /platform/auth/login': 'public',
  'POST /platform/auth/logout': 'platform',
  'POST /platform/auth/refresh': 'public',
  'POST /platform/auth/totp/verify': 'public',
  'GET /platform/support-access': 'platform',
  'POST /platform/support-access': 'platform',
  'POST /platform/support-access/:id/token': 'platform',
  'GET /platform/tenants': 'platform',
  'POST /platform/tenants': 'platform',
  'GET /platform/tenants/:id': 'platform',
  'POST /platform/tenants/:id/admin-invitation': 'platform',
  'PUT /platform/tenants/:id/plan': 'platform',
  'POST /platform/tenants/:id/reactivate': 'platform',
  'POST /platform/tenants/:id/suspend': 'platform',
  'GET /staff': 'permissions: staff:read',
  'PUT /staff/:userId/branches': 'permissions: staff:manage',
  'POST /staff/:userId/disable': 'permissions: staff:manage',
  'POST /staff/:userId/enable': 'permissions: staff:manage',
  'PUT /staff/:userId/roles': 'permissions: staff:manage',
  'POST /staff/:userId/unlock': 'permissions: staff:manage',
  'GET /staff-invitations': 'permissions: staff:read',
  'POST /staff-invitations': 'permissions: staff:manage',
  'POST /staff-invitations/:id/resend': 'permissions: staff:manage',
  'POST /staff-invitations/:id/revoke': 'permissions: staff:manage',
  'GET /support-access-requests': 'permissions: support_access:manage',
  'POST /support-access-requests/:id/approve': 'permissions: support_access:manage',
  'POST /support-access-requests/:id/reject': 'permissions: support_access:manage',
  'POST /support-access-requests/:id/revoke': 'permissions: support_access:manage',
  'GET /tenant': 'permissions: tenant:read',
  'PATCH /tenant': 'permissions: tenant:settings',
};

describe('Route inventory (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, app.get<ConfigService<Env, true>>(ConfigService));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function inventory() {
    return listRoutes(app.get(DiscoveryService), app.get(MetadataScanner), app.get(Reflector));
  }

  it('matches the reviewed access decision for every route', () => {
    const actual = Object.fromEntries(
      inventory().map((entry) => [
        entry.route,
        entry.access === 'permissions'
          ? `permissions: ${entry.permissions.join(', ')}`
          : entry.access,
      ]),
    );
    expect(actual).toEqual(EXPECTED);
  });

  it('has no route with a contradictory or missing decision', () => {
    expect(inventory().filter((entry) => entry.problems.length > 0)).toEqual([]);
  });

  it.each(
    Object.entries(EXPECTED)
      .filter(([, access]) => access !== 'public')
      .map(([route]) => route.split(' ') as [string, string]),
  )('%s %s refuses a request without a token', async (method, path) => {
    const url = `/api/v1${path.replace(/:[a-zA-Z]+/g, '01890000-0000-7000-8000-000000000000')}`;
    const response = await request(app.getHttpServer())
      [method.toLowerCase() as 'get' | 'post' | 'put' | 'patch'](url)
      .send({});
    expect(response.status).toBe(401);
  });
});
