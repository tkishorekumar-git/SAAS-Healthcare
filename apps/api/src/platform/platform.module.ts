import { Module } from '@nestjs/common';
import { TokensModule } from '../auth/tokens.module';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformSessionService } from './platform-session.service';
import { PlatformSupportAccessService } from './platform-support-access.service';
import {
  PlatformAuthController,
  PlatformSupportAccessController,
  PlatformTenantsController,
} from './platform.controllers';

/** Super Admin features. Uses only PlatformDatabase (kenisha_platform). */
@Module({
  imports: [TokensModule],
  controllers: [PlatformAuthController, PlatformTenantsController, PlatformSupportAccessController],
  providers: [
    PlatformAuditService,
    PlatformAuthService,
    PlatformSessionService,
    PlatformSupportAccessService,
  ],
  exports: [PlatformSessionService],
})
export class PlatformModule {}
