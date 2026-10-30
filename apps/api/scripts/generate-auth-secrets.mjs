// Prints fresh authentication secrets for apps/api/.env (or a production secret store).
// Usage: pnpm --filter @kenisha/api auth:secrets
// Never commit the output. Rotating JWT keys signs everyone out within 15 minutes.
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const b64 = (pem) => Buffer.from(pem).toString('base64');

process.stdout.write(
  [
    `JWT_PRIVATE_KEY=${b64(privateKey.export({ type: 'pkcs8', format: 'pem' }))}`,
    `JWT_PUBLIC_KEY=${b64(publicKey.export({ type: 'spki', format: 'pem' }))}`,
    `OTP_HMAC_SECRET=${randomBytes(32).toString('hex')}`,
    '',
  ].join('\n'),
);
