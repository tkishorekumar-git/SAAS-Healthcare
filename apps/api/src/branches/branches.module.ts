import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TenancyModule } from '../tenancy/tenancy.module';
import { BranchesController } from './branches.controller';

@Module({
  imports: [AuditModule, TenancyModule],
  controllers: [BranchesController],
})
export class BranchesModule {}
