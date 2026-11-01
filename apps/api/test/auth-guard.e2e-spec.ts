import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/configure-app';
import type { Env } from '../src/config/env.validation';

/** Auth enforcement and input validation that need no database. */
describe('Authentication guard and validation (e2e)', () => {
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

  it.each(['/api/v1/branches', '/api/v1/auth/me', '/api/v1/audit-events'])(
    'denies %s without a token',
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(401);
    },
  );

  it('denies a forged token before touching the database', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ sub: 'x', tid: 'y' })).toString('base64url');
    await request(app.getHttpServer())
      .get('/api/v1/branches')
      .set('Authorization', `Bearer ${header}.${body}.`)
      .expect(401);
  });

  it('does not echo malformed JSON back to the caller', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/otp/request')
      .set('Content-Type', 'application/json')
      .send('{"phone": "Zenobia Quillfeather')
      .expect(400);
    expect(response.body).toMatchObject({ message: 'Request body is not valid JSON.' });
    expect(JSON.stringify(response.body)).not.toContain('Zenobia');
  });

  it('does not echo the path of an unknown route', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/no-such-route/Zenobia-Quillfeather')
      .expect(404);
    expect(JSON.stringify(response.body)).not.toContain('Zenobia');
  });

  it('keeps health endpoints public', async () => {
    await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });

  it('rejects unknown fields in login requests', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/otp/request')
      .send({ hospitalCode: 'demo-aarogya', phone: '+919000000001', tenantId: 'injected' })
      .expect(400);
  });

  it('rejects a malformed hospital code with a helpful message', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/staff/login')
      .send({ hospitalCode: 'bad code!', identifier: 'x@y.test', password: 'p', client: 'web' })
      .expect(400);
    expect(JSON.stringify(response.body)).toMatch(/hospitalCode/);
  });

  it('requires a refresh token', async () => {
    await request(app.getHttpServer()).post('/api/v1/auth/refresh').send({}).expect(401);
  });
});
