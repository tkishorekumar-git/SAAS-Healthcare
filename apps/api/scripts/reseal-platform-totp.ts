/**
 * Step 3 of a PLATFORM_TOTP_KEY rotation (docs/security/runbooks/secret-rotation.md):
 * re-encrypts every Super Admin authenticator secret under the current key, so the
 * previous key can be removed. Safe to run more than once.
 *
 *   pnpm --filter @kenisha/api platform:reseal-totp
 *
 * Reads PLATFORM_DATABASE_URL, PLATFORM_TOTP_KEY and PLATFORM_TOTP_KEY_PREVIOUS from
 * apps/api/.env. Prints counts only.
 */
import { createPrismaClient } from '@kenisha/database';
import { config } from 'dotenv';
import {
  loadSecretBoxKey,
  needsReseal,
  openSecret,
  sealSecret,
} from '../src/auth/crypto/secret-box';

config({ quiet: true });

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.PLATFORM_DATABASE_URL ?? fail('PLATFORM_DATABASE_URL is not set');
  const current = loadSecretBoxKey(
    process.env.PLATFORM_TOTP_KEY ?? fail('PLATFORM_TOTP_KEY is not set'),
  );
  const previous = process.env.PLATFORM_TOTP_KEY_PREVIOUS;
  const keys = previous ? [current, loadSecretBoxKey(previous)] : [current];

  const db = createPrismaClient(databaseUrl, { maxConnections: 1 });
  let resealed = 0;
  let failed = 0;
  try {
    const users = await db.platformUser.findMany({
      select: { id: true, totpSecretEncrypted: true },
    });
    for (const user of users) {
      if (!needsReseal(user.totpSecretEncrypted, current)) continue;
      try {
        const secret = openSecret(user.totpSecretEncrypted, keys);
        // Only if unchanged since it was read (a concurrent login may have re-sealed it).
        const updated = await db.platformUser.updateMany({
          where: { id: user.id, totpSecretEncrypted: user.totpSecretEncrypted },
          data: { totpSecretEncrypted: sealSecret(secret, current) },
        });
        resealed += updated.count;
      } catch {
        failed += 1;
      }
    }
    process.stdout.write(
      `Super Admin accounts: ${users.length}; re-encrypted: ${resealed}; unreadable: ${failed}\n`,
    );
    if (failed > 0) {
      fail('some secrets could not be read - keep PLATFORM_TOTP_KEY_PREVIOUS and investigate');
    }
  } finally {
    await db.$disconnect();
  }
}

void main();
