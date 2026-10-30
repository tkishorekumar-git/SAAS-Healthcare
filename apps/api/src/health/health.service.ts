import { type ConnectionRoleCheck, DATABASE_ROLES } from '@kenisha/database';
import type { DependencyState, HealthStatus, ReadinessStatus } from '@kenisha/shared';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SERVICE_NAME, SERVICE_VERSION } from '../app.constants';
import type { Env } from '../config/env.validation';
import { PlatformDatabase } from '../database/platform-database.service';
import { TenantDatabase } from '../database/tenant-database.service';

const DATABASE_CHECK_TIMEOUT_MS = 3000;

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly database: TenantDatabase,
    private readonly platformDatabase: PlatformDatabase,
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
    const [database, platformDatabase] = await Promise.all([
      this.checkConnection('DATABASE_URL', DATABASE_ROLES.app, () => this.database.checkRole()),
      this.checkConnection('PLATFORM_DATABASE_URL', DATABASE_ROLES.platform, () =>
        this.platformDatabase.checkRole(),
      ),
    ]);
    return {
      status: database === 'up' && platformDatabase === 'up' ? 'ok' : 'error',
      checks: { database, platformDatabase },
      timestamp: now.toISOString(),
    };
  }

  /** Reachable, least-privilege, and logged in as the role this connection is meant for. */
  private async checkConnection(
    setting: string,
    expectedRole: string,
    check: () => Promise<ConnectionRoleCheck>,
  ): Promise<DependencyState> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), DATABASE_CHECK_TIMEOUT_MS);
    });

    try {
      const role = await Promise.race([check(), timeout]);
      if (!role.safe || role.role !== expectedRole) {
        // Never log the connection URL — only the role name and which guarantee is broken.
        this.logger.error(
          `${setting} logs in as "${role.role}" (expected ${expectedRole}; ` +
            `superuser=${role.isSuperuser}, bypassrls=${role.bypassesRls}, ownsTables=${role.ownsTables}).`,
        );
        return 'misconfigured';
      }
      return 'up';
    } catch (error) {
      this.logger.warn(
        `${setting} readiness check failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
