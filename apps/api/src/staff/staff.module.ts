import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SmsModule } from '../auth/sms/sms.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { InvitationsService } from './invitations.service';
import {
  InvitationAcceptanceController,
  StaffController,
  StaffInvitationsController,
} from './staff.controllers';
import { StaffService } from './staff.service';

@Module({
  imports: [AuditModule, SmsModule, TenancyModule],
  controllers: [StaffController, StaffInvitationsController, InvitationAcceptanceController],
  providers: [StaffService, InvitationsService],
})
export class StaffModule {}
