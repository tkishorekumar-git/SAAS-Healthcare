import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SupportAccessController } from './support-access.controller';
import { SupportAccessService } from './support-access.service';

@Module({
  imports: [AuditModule],
  controllers: [SupportAccessController],
  providers: [SupportAccessService],
  exports: [SupportAccessService],
})
export class SupportAccessModule {}
