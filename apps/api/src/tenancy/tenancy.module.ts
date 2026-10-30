import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PlanLimitsService } from './plan-limits.service';
import { TenantController } from './tenant.controller';

@Module({
  imports: [AuditModule],
  controllers: [TenantController],
  providers: [PlanLimitsService],
  exports: [PlanLimitsService],
})
export class TenancyModule {}
