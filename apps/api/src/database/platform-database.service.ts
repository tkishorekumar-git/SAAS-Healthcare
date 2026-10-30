import { type ConnectionRoleCheck, PrismaClient, checkConnectionRole } from '@kenisha/database';
import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PLATFORM_PRISMA_CLIENT } from './database.constants';

/**
 * Database access for Super Admin (platform) features, connected as kenisha_platform.
 * PostgreSQL grants this role no privileges on hospital tables (ADR-0002, D2), so even a
 * bug in platform code cannot read patient or staff data.
 */
@Injectable()
export class PlatformDatabase implements OnModuleDestroy {
  constructor(@Inject(PLATFORM_PRISMA_CLIENT) readonly client: PrismaClient) {}

  checkRole(): Promise<ConnectionRoleCheck> {
    return checkConnectionRole(this.client);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
