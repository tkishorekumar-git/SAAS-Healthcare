/**
 * Regression: timestamps written by the application must equal the database clock's view,
 * whatever time zone the server runs in (a local server in IST once shifted them 5.5 h).
 */
import { afterAll, expect, inject, it } from 'vitest';
import { createPrismaClient } from '../src/client';

const platform = createPrismaClient(inject('databaseUrls').platform, { maxConnections: 1 });

afterAll(() => platform.$disconnect());

it('stores application timestamps at the same instant the database sees', async () => {
  const written = new Date();
  const user = await platform.platformUser.create({
    data: {
      email: `tz-${written.getTime()}@platform.example.test`,
      displayName: 'Synthetic TZ check',
      passwordHash: '$argon2id$synthetic',
      totpSecretEncrypted: 'v1.synthetic',
      lockedUntil: written,
    },
  });
  const [row] = await platform.$queryRaw<Array<{ drift_seconds: number }>>`
    SELECT abs(extract(epoch FROM (now() - locked_until)))::float AS drift_seconds
    FROM platform_users WHERE id = ${user.id}::uuid`;
  expect(row!.drift_seconds).toBeLessThan(60);
});
