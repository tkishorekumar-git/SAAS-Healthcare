import 'dotenv/config';
import type { DatabaseRoleKey } from '../src/bootstrap';

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set — copy packages/database/.env.example to .env`);
  }
  return value;
}

/** Connection URLs for the three application roles. */
export function roleUrlsFromEnv(): Record<DatabaseRoleKey, string> {
  return {
    migrator: requireEnv('MIGRATION_DATABASE_URL'),
    app: requireEnv('APP_DATABASE_URL'),
    platform: requireEnv('PLATFORM_DATABASE_URL'),
  };
}
