import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describeError } from '../bootstrap/safe-exception.filter';
import type { Env } from '../config/env.validation';
import { TenantDatabase } from '../database/tenant-database.service';

/**
 * Data minimisation (ADR-0005): periodically deletes one-time codes, sessions, invitations
 * and known devices that are past retention. Safe to run on several instances at once.
 */
@Injectable()
export class AuthDataPurgeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AuthDataPurgeService.name);
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly db: TenantDatabase,
    config: ConfigService<Env, true>,
  ) {
    this.intervalMs = config.get('AUTH_DATA_PURGE_INTERVAL_MINUTES', { infer: true }) * 60_000;
  }

  onApplicationBootstrap(): void {
    if (this.intervalMs === 0) return;
    this.timer = setInterval(() => void this.purge(), this.intervalMs);
    // Never keeps the process alive on shutdown.
    this.timer.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** Logs counts only. Failures are logged and retried on the next run. */
  async purge(): Promise<void> {
    try {
      const counts = await this.db.purgeExpiredAuthData();
      const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
      if (total > 0) {
        this.logger.log(`Purged expired authentication data: ${JSON.stringify(counts)}`);
      }
    } catch (error) {
      this.logger.warn(`Authentication data purge failed: ${describeError(error)}`);
    }
  }
}
