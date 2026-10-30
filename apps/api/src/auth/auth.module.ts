import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PlatformModule } from '../platform/platform.module';
import { SupportAccessModule } from '../support-access/support-access.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard, PermissionsGuard } from './guards';
import { SessionService } from './session.service';
import { SmsModule } from './sms/sms.module';
import { TokensModule } from './tokens.module';

@Module({
  imports: [
    AuditModule,
    SmsModule,
    TenancyModule,
    TokensModule,
    PlatformModule,
    SupportAccessModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService, AuthGuard, PermissionsGuard],
  exports: [AuthGuard, PermissionsGuard],
})
export class AuthModule {}
