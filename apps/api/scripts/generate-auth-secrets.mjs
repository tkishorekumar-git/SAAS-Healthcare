// Prints fresh authentication secrets for apps/api/.env (or a production secret store).
// Usage: pnpm --filter @kenisha/api auth:secrets
// Never commit the output. To rotate a key in a running environment, follow
// docs/security/runbooks/secret-rotation.md (no one is signed out if you do).
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const b64 = (pem) => Buffer.from(pem).toString('base64');

process.stdout.write(
  [
    `JWT_PRIVATE_KEY=${b64(privateKey.export({ type: 'pkcs8', format: 'pem' }))}`,
    `JWT_PUBLIC_KEY=${b64(publicKey.export({ type: 'spki', format: 'pem' }))}`,
    `OTP_HMAC_SECRET=${randomBytes(32).toString('hex')}`,
    `PLATFORM_TOTP_KEY=${randomBytes(32).toString('base64')}`,
    '',
  ].join('\n'),
);
