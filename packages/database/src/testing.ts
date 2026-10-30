/**
 * Test-only helpers (`@kenisha/database/testing`). Never import from production code.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Client } from 'pg';
import { type DatabaseRoleKey, bootstrapDatabase, rolePasswordsFromUrls } from './bootstrap';
import { parseDatabaseUrl } from './client';

export interface TestDatabaseUrls {
  admin: string;
  migrator: string;
  app: string;
  platform: string;
}

export interface TestDatabase {
  name: string;
  urls: TestDatabaseUrls;
  drop(): Promise<void>;
}

/** Returns the same connection URL pointed at a different database. */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** Reads the four database URLs from the environment (packages/database/.env or CI). */
export function testDatabaseEnv(): { adminUrl: string; roleUrls: Record<DatabaseRoleKey, string> } {
  const read = (name: string): string => {
    const value = process.env[name];
    if (!value) {
      throw new Error(`${name} is not set — database tests need packages/database/.env`);
    }
    return value;
  };
  return {
    adminUrl: read('DATABASE_ADMIN_URL'),
    roleUrls: {
      migrator: read('MIGRATION_DATABASE_URL'),
      app: read('APP_DATABASE_URL'),
      platform: read('PLATFORM_DATABASE_URL'),
    },
  };
}

/**
 * Creates a uniquely named database on the admin server, bootstraps the roles, applies
 * every migration as kenisha_migrator, and returns role URLs pointed at it.
 */
export async function createTestDatabase(
  adminUrl: string,
  roleUrls: Record<DatabaseRoleKey, string>,
): Promise<TestDatabase> {
  const serverUrl = parseDatabaseUrl(adminUrl).connectionString;
  const name = `kenisha_it_${randomBytes(4).toString('hex')}`;

  const admin = new Client({ connectionString: serverUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(name)}`);
  } finally {
    await admin.end();
  }

  const urls: TestDatabaseUrls = {
    admin: withDatabase(serverUrl, name),
    migrator: withDatabase(roleUrls.migrator, name),
    app: withDatabase(roleUrls.app, name),
    platform: withDatabase(roleUrls.platform, name),
  };

  const testAdmin = new Client({ connectionString: urls.admin });
  await testAdmin.connect();
  try {
    await bootstrapDatabase(testAdmin, rolePasswordsFromUrls(roleUrls), {
      allowMigratorCreateDb: false,
    });
  } finally {
    await testAdmin.end();
  }

  const packageRoot = path.resolve(__dirname, '..');
  const prismaCli = require.resolve('prisma/build/index.js', { paths: [packageRoot] });
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: packageRoot,
    env: { ...process.env, MIGRATION_DATABASE_URL: urls.migrator },
    stdio: 'pipe',
  });

  return {
    name,
    urls,
    async drop() {
      const cleanup = new Client({ connectionString: serverUrl });
      await cleanup.connect();
      try {
        await cleanup.query(
          `DROP DATABASE IF EXISTS ${cleanup.escapeIdentifier(name)} WITH (FORCE)`,
        );
      } finally {
        await cleanup.end();
      }
    },
  };
}
