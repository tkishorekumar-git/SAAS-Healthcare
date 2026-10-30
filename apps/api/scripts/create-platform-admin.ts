/**
 * Creates a Super Admin (platform) account. Run by an operator on a trusted machine:
 *
 *   NEW_PLATFORM_ADMIN_PASSWORD='...' pnpm --filter @kenisha/api platform:create-admin \
 *     --email ops.lead@example.test --name "Ops Lead"
 *
 * The password comes from an environment variable (never a CLI argument, which would land
 * in shell history). The authenticator secret is printed ONCE: add it to an authenticator
 * app immediately. Reads PLATFORM_DATABASE_URL and PLATFORM_TOTP_KEY from apps/api/.env.
 */
import { createPrismaClient } from '@kenisha/database';
import { config } from 'dotenv';
import { parseArgs } from 'node:util';
import { loadSecretBoxKey, sealSecret } from '../src/auth/crypto/secret-box';
import { generateTotpSecret, totpProvisioningUri } from '../src/auth/crypto/totp';
import { hashPassword } from '../src/auth/password/password-hasher';
import { checkPasswordPolicy } from '../src/auth/password/password-policy';

config({ quiet: true });

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, name: { type: 'string' } },
  });
  const email = values.email?.trim().toLowerCase();
  const name = values.name?.trim();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('--email is required');
  if (!name) fail('--name is required');

  const password = process.env.NEW_PLATFORM_ADMIN_PASSWORD ?? '';
  const problems = checkPasswordPolicy(password, { email });
  if (problems.length > 0) fail(`NEW_PLATFORM_ADMIN_PASSWORD ${problems.join('; ')}`);

  const databaseUrl = process.env.PLATFORM_DATABASE_URL ?? fail('PLATFORM_DATABASE_URL is not set');
  const key = loadSecretBoxKey(
    process.env.PLATFORM_TOTP_KEY ?? fail('PLATFORM_TOTP_KEY is not set'),
  );

  const db = createPrismaClient(databaseUrl, { maxConnections: 1 });
  try {
    if (await db.platformUser.findUnique({ where: { email } })) {
      fail(`a platform account for ${email} already exists`);
    }
    const secret = generateTotpSecret();
    await db.platformUser.create({
      data: {
        email,
        displayName: name,
        passwordHash: await hashPassword(password),
        totpSecretEncrypted: sealSecret(secret, key),
      },
    });

    process.stdout.write(
      [
        `Created Super Admin ${email}.`,
        '',
        'Add this account to an authenticator app NOW — it is shown only once:',
        `  Secret : ${secret}`,
        `  URI    : ${totpProvisioningUri(secret, email)}`,
        '',
        'Then clear your terminal scrollback.',
        '',
      ].join('\n'),
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
