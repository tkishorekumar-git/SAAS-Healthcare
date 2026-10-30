/**
 * Creates the kenisha_migrator / kenisha_app / kenisha_platform roles and the application
 * schema. Run once per database as an admin, before the first migration:
 *
 *   pnpm --filter @kenisha/database db:bootstrap
 */
import { Client } from 'pg';
import { bootstrapDatabase, rolePasswordsFromUrls } from '../src/bootstrap';
import { parseDatabaseUrl } from '../src/client';
import { requireEnv, roleUrlsFromEnv } from './env';

async function main(): Promise<void> {
  const roleUrls = roleUrlsFromEnv();
  const passwords = rolePasswordsFromUrls(roleUrls);
  const { schema } = parseDatabaseUrl(roleUrls.migrator);
  const admin = new Client({
    connectionString: parseDatabaseUrl(requireEnv('DATABASE_ADMIN_URL')).connectionString,
  });

  await admin.connect();
  try {
    await bootstrapDatabase(admin, passwords, {
      schema,
      allowMigratorCreateDb: process.env.NODE_ENV !== 'production',
    });
  } finally {
    await admin.end();
  }
  console.warn(`Database roles and schema "${schema}" are ready.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
