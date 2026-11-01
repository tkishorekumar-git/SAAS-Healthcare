import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard, PermissionsGuard } from './auth/guards';
import { BranchesModule } from './branches/branches.module';
import { validateEnv } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { StaffModule } from './staff/staff.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { throttlerOptions } from './throttling/throttler.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: throttlerOptions,
    }),
    DatabaseModule,
    AuditModule,
    AuthModule,
    BranchesModule,
    HealthModule,
    MaintenanceModule,
    StaffModule,
    TenancyModule,
  ],
  // Guards run in this order: rate limit → authenticate (deny by default) → permissions.
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useExisting: PermissionsGuard },
  ],
})
export class AppModule {}
