import { Module } from '@nestjs/common';
import { AuthDataPurgeService } from './auth-data-purge.service';

@Module({
  providers: [AuthDataPurgeService],
  exports: [AuthDataPurgeService],
})
export class MaintenanceModule {}
