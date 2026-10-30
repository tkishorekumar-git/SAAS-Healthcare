// Throwaway authentication secrets generated per test run — nothing is committed.
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const b64 = (pem: string | Buffer) => Buffer.from(pem).toString('base64');

process.env.NODE_ENV = 'test';
process.env.JWT_PRIVATE_KEY = b64(privateKey.export({ type: 'pkcs8', format: 'pem' }));
process.env.JWT_PUBLIC_KEY = b64(publicKey.export({ type: 'spki', format: 'pem' }));
process.env.OTP_HMAC_SECRET = randomBytes(32).toString('hex');
process.env.SMS_PROVIDER = 'development';
process.env.AUTH_COOKIE_SECURE = 'false';
// Tests log in many times from one address; the real per-IP limit is unit-tested separately.
process.env.AUTH_THROTTLE_LIMIT = '1000';
