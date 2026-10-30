/**
 * Integration-test database lifecycle: a throwaway database with all migrations applied,
 * dropped afterwards. URLs come from packages/database/.env (or CI env).
 */
import 'dotenv/config';
import type { TestProject } from 'vitest/node';
import { type TestDatabaseUrls, createTestDatabase, testDatabaseEnv } from '../src/testing';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const { adminUrl, roleUrls } = testDatabaseEnv();
  const database = await createTestDatabase(adminUrl, roleUrls);
  project.provide('databaseUrls', database.urls);
  return () => database.drop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrls: TestDatabaseUrls;
  }
}
