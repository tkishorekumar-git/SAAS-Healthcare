import { Module } from '@nestjs/common';
import { SmsModule } from '../auth/sms/sms.module';
import { TokensModule } from '../auth/tokens.module';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformSessionService } from './platform-session.service';
import { PlatformSupportAccessService } from './platform-support-access.service';
import { PlatformTenantsController } from './platform-tenants.controller';
import { PlatformTenantsService } from './platform-tenants.service';
import { PlatformAuthController, PlatformSupportAccessController } from './platform.controllers';

/** Super Admin features. Uses only PlatformDatabase (kenisha_platform). */
@Module({
  imports: [TokensModule, SmsModule],
  controllers: [PlatformAuthController, PlatformTenantsController, PlatformSupportAccessController],
  providers: [
    PlatformAuditService,
    PlatformAuthService,
    PlatformSessionService,
    PlatformSupportAccessService,
    PlatformTenantsService,
  ],
  exports: [PlatformSessionService],
})
export class PlatformModule {}
