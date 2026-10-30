import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import type { Env } from '../config/env.validation';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard, PermissionsGuard } from './guards';
import { SessionService } from './session.service';
import { DevelopmentSmsProvider, SMS_PROVIDER } from './sms/sms.provider';
import { TokenService } from './token.service';

@Module({
  imports: [AuditModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    TokenService,
    AuthGuard,
    PermissionsGuard,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        switch (config.get('SMS_PROVIDER', { infer: true })) {
          case 'development':
            return new DevelopmentSmsProvider(config.get('NODE_ENV', { infer: true }));
        }
      },
    },
  ],
  exports: [AuthGuard, PermissionsGuard],
})
export class AuthModule {}
