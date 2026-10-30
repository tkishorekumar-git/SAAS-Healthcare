import type { Client } from 'pg';
import { DEFAULT_SCHEMA, parseDatabaseUrl } from './client';

/** Role names are fixed: migrations grant privileges to these exact names. */
export const DATABASE_ROLES = {
  migrator: 'kenisha_migrator',
  app: 'kenisha_app',
  platform: 'kenisha_platform',
} as const;

export type DatabaseRoleKey = keyof typeof DATABASE_ROLES;

export type RolePasswords = Record<DatabaseRoleKey, string>;

export interface BootstrapOptions {
  schema?: string;
  /** `prisma migrate dev` creates a temporary shadow database. Never enable in production. */
  allowMigratorCreateDb: boolean;
}

const MIN_PASSWORD_LENGTH = 12;

/**
 * Extracts and validates the password for each role from its connection URL, so each
 * password is configured in exactly one place.
 */
export function rolePasswordsFromUrls(urls: Record<DatabaseRoleKey, string>): RolePasswords {
  const passwords = {} as RolePasswords;
  for (const key of Object.keys(DATABASE_ROLES) as DatabaseRoleKey[]) {
    const url = new URL(parseDatabaseUrl(urls[key]).connectionString);
    const expectedRole = DATABASE_ROLES[key];
    if (decodeURIComponent(url.username) !== expectedRole) {
      throw new Error(`The ${key} database URL must log in as ${expectedRole}`);
    }
    const password = decodeURIComponent(url.password);
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        `The ${key} database URL needs a password of at least ${MIN_PASSWORD_LENGTH} characters`,
      );
    }
    passwords[key] = password;
  }
  return passwords;
}

/**
 * Idempotently creates the three least-privilege roles and the application schema.
 * Must run as a superuser (local/CI) or a provisioning admin (production), connected to
 * the target database. Re-running rotates passwords to the supplied values.
 */
export async function bootstrapDatabase(
  admin: Client,
  passwords: RolePasswords,
  options: BootstrapOptions,
): Promise<void> {
  const schema = admin.escapeIdentifier(options.schema ?? DEFAULT_SCHEMA);
  const { migrator, app, platform } = DATABASE_ROLES;

  for (const key of Object.keys(DATABASE_ROLES) as DatabaseRoleKey[]) {
    const role = DATABASE_ROLES[key];
    const ident = admin.escapeIdentifier(role);
    const existing = await admin.query('SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1', [
      role,
    ]);
    if (existing.rowCount === 0) {
      await admin.query(`CREATE ROLE ${ident}`);
    }
    const createDb =
      key === 'migrator' && options.allowMigratorCreateDb ? 'CREATEDB' : 'NOCREATEDB';
    await admin.query(
      `ALTER ROLE ${ident} WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOREPLICATION ` +
        `${createDb} PASSWORD ${admin.escapeLiteral(passwords[key])}`,
    );
  }

  const { rows } = await admin.query<{ db: string }>('SELECT current_database() AS db');
  const database = admin.escapeIdentifier(rows[0]!.db);

  await admin.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await admin.query(`GRANT CONNECT ON DATABASE ${database} TO ${migrator}, ${app}, ${platform}`);
  // Prisma issues CREATE SCHEMA IF NOT EXISTS, which needs CREATE on the database.
  await admin.query(`GRANT CREATE ON DATABASE ${database} TO ${migrator}`);
  await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await admin.query(`CREATE SCHEMA IF NOT EXISTS ${schema} AUTHORIZATION ${migrator}`);
  await admin.query(`ALTER SCHEMA ${schema} OWNER TO ${migrator}`);
  await admin.query(`REVOKE ALL ON SCHEMA ${schema} FROM PUBLIC`);
  await admin.query(`GRANT USAGE ON SCHEMA ${schema} TO ${app}, ${platform}`);
}
