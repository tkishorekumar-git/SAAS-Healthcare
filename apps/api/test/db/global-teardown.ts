import type { TestDatabase } from '@kenisha/database/testing';

export default async function globalTeardown(): Promise<void> {
  await (globalThis as { __kenishaE2eDb?: TestDatabase }).__kenishaE2eDb?.drop();
}
