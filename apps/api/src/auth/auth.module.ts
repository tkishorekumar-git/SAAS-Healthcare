import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { AuditModule } from '../audit/audit.module';
import { PlatformModule } from '../platform/platform.module';
import { SupportAccessModule } from '../support-access/support-access.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard, PermissionsGuard } from './guards';
import { KnownDeviceService } from './known-devices.service';
import { RouteAccessCheck } from './route-access';
import { SessionService } from './session.service';
import { SmsModule } from './sms/sms.module';
import { TokensModule } from './tokens.module';

@Module({
  imports: [
    DiscoveryModule,
    AuditModule,
    SmsModule,
    TenancyModule,
    TokensModule,
    PlatformModule,
    SupportAccessModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    KnownDeviceService,
    AuthGuard,
    PermissionsGuard,
    RouteAccessCheck,
  ],
  exports: [AuthGuard, PermissionsGuard],
})
export class AuthModule {}
