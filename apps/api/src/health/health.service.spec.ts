import type { ConnectionRoleCheck } from '@kenisha/database';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SERVICE_NAME, SERVICE_VERSION } from '../app.constants';
import { TenantDatabase } from '../database/tenant-database.service';
import { HealthService } from './health.service';

const safeRole: ConnectionRoleCheck = {
  role: 'kenisha_app',
  isSuperuser: false,
  bypassesRls: false,
  ownsTables: false,
  safe: true,
};

describe('HealthService', () => {
  let service: HealthService;
  let checkRole: jest.Mock<Promise<ConnectionRoleCheck>, []>;

  beforeEach(async () => {
    checkRole = jest.fn<Promise<ConnectionRoleCheck>, []>().mockResolvedValue(safeRole);
    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('test') } },
        { provide: TenantDatabase, useValue: { checkRole } },
      ],
    }).compile();

    service = moduleRef.get(HealthService);
  });

  it('reports liveness with service metadata', () => {
    const status = service.getStatus(new Date('2026-10-30T09:00:00.000Z'));

    expect(status).toMatchObject({
      status: 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      environment: 'test',
      timestamp: '2026-10-30T09:00:00.000Z',
    });
    expect(status.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });

  it('is ready when the database is reachable as a least-privilege role', async () => {
    await expect(service.getReadiness()).resolves.toMatchObject({
      status: 'ok',
      checks: { database: 'up' },
    });
  });

  it('is not ready when the database is unreachable', async () => {
    checkRole.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(service.getReadiness()).resolves.toMatchObject({
      status: 'error',
      checks: { database: 'down' },
    });
  });

  it('is not ready when connected as a role that can bypass RLS', async () => {
    checkRole.mockResolvedValue({ ...safeRole, role: 'postgres', isSuperuser: true, safe: false });

    await expect(service.getReadiness()).resolves.toMatchObject({
      status: 'error',
      checks: { database: 'misconfigured' },
    });
  });
});
