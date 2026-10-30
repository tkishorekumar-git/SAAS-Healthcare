import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for small secrets stored in the database (TOTP seeds).
 * Format: `v1.<iv>.<ciphertext>.<auth tag>` (base64url). The version prefix allows key
 * rotation later. Tampering with any part makes decryption fail.
 */
const VERSION = 'v1';

export function loadSecretBoxKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error('PLATFORM_TOTP_KEY must be 32 bytes, base64-encoded');
  }
  return key;
}

export function sealSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, ciphertext, tag]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

export function openSecret(sealed: string, key: Buffer): string {
  const [version, iv, ciphertext, tag] = sealed.split('.');
  if (version !== VERSION || !iv || !ciphertext || !tag) {
    throw new Error('Unsupported or malformed sealed secret');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
