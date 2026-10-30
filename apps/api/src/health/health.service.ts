import type { DependencyState, HealthStatus, ReadinessStatus } from '@kenisha/shared';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SERVICE_NAME, SERVICE_VERSION } from '../app.constants';
import type { Env } from '../config/env.validation';
import { TenantDatabase } from '../database/tenant-database.service';

const DATABASE_CHECK_TIMEOUT_MS = 3000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly database: TenantDatabase,
  ) {}

  /** Liveness: the process is running. Never touches dependencies. */
  getStatus(now: Date = new Date()): HealthStatus {
    return {
      status: 'ok',
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      environment: this.config.get('NODE_ENV', { infer: true }),
      timestamp: now.toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  /** Readiness: dependencies are reachable and safely configured. */
  async getReadiness(now: Date = new Date()): Promise<ReadinessStatus> {
    const database = await this.checkDatabase();
    return {
      status: database === 'up' ? 'ok' : 'error',
      checks: { database },
      timestamp: now.toISOString(),
    };
  }

  private async checkDatabase(): Promise<DependencyState> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), DATABASE_CHECK_TIMEOUT_MS);
    });

    try {
      const role = await Promise.race([this.database.checkRole(), timeout]);
      if (!role.safe) {
        // Never log the connection URL — only the role name and which guarantee is broken.
        this.logger.error(
          `Database role "${role.role}" can bypass Row-Level Security ` +
            `(superuser=${role.isSuperuser}, bypassrls=${role.bypassesRls}, ownsTables=${role.ownsTables}). ` +
            'Connect the API as kenisha_app.',
        );
        return 'misconfigured';
      }
      return 'up';
    } catch (error) {
      this.logger.warn(
        `Database readiness check failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
