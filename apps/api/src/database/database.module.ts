import { createPrismaClient } from '@kenisha/database';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { PLATFORM_PRISMA_CLIENT, PRISMA_CLIENT } from './database.constants';
import { PlatformDatabase } from './platform-database.service';
import { TenantDatabase } from './tenant-database.service';

/**
 * Two connections with different PostgreSQL roles:
 * - kenisha_app (TenantDatabase): hospital data, RLS-scoped per request.
 * - kenisha_platform (PlatformDatabase): Super Admin tables only.
 * Both connect lazily, so the API can start (and report not-ready) without a database.
 * The raw clients never leave this module.
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
    {
      provide: PLATFORM_PRISMA_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createPrismaClient(config.get('PLATFORM_DATABASE_URL', { infer: true }), {
          maxConnections: 3,
        }),
    },
    TenantDatabase,
    PlatformDatabase,
  ],
  exports: [TenantDatabase, PlatformDatabase],
})
export class DatabaseModule {}
