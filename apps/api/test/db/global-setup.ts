// Creates a throwaway, fully migrated PostgreSQL database for the real-database e2e suite.
// Reads the same URLs as packages/database (its .env locally, CI environment otherwise).
import { createTestDatabase, testDatabaseEnv } from '@kenisha/database/testing';
import { config } from 'dotenv';
import path from 'node:path';

export default async function globalSetup(): Promise<void> {
  config({ path: path.resolve(__dirname, '../../../../packages/database/.env'), quiet: true });
  const { adminUrl, roleUrls } = testDatabaseEnv();
  const database = await createTestDatabase(adminUrl, roleUrls);

  process.env.KENISHA_E2E_APP_URL = database.urls.app;
  process.env.KENISHA_E2E_PLATFORM_URL = database.urls.platform;
  (globalThis as { __kenishaE2eDb?: typeof database }).__kenishaE2eDb = database;
}
