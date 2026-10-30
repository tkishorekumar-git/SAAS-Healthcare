import { createPrismaClient } from '@kenisha/database';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { PRISMA_CLIENT } from './database.constants';
import { TenantDatabase } from './tenant-database.service';

/**
 * Connects as kenisha_app. The client connects lazily on first query, so the API can
 * start (and report not-ready) while the database is unavailable.
 * Only TenantDatabase is exported — the raw client never leaves this module.
 */
@Global()
@Module({
  providers: [
    {
      provide: PRISMA_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createPrismaClient(config.get('DATABASE_URL', { infer: true }), {
          maxConnections: config.get('DATABASE_POOL_MAX', { infer: true }),
        }),
    },
    TenantDatabase,
  ],
  exports: [TenantDatabase],
})
export class DatabaseModule {}
