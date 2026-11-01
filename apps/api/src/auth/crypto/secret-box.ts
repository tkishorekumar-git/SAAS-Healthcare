import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM encryption for small secrets stored in the database (TOTP seeds).
 *
 * Format `v2.<key id>.<iv>.<ciphertext>.<auth tag>` (base64url). The key ID names the key
 * that sealed the secret, so a rotation can run with the previous key still readable
 * (ADR-0005). `v1.<iv>.<ciphertext>.<tag>` (no key ID) is still read. Tampering with any
 * part makes decryption fail.
 */
const VERSION = 'v2';

export function loadSecretBoxKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error('PLATFORM_TOTP_KEY must be 32 bytes, base64-encoded');
  }
  return key;
}

/** Public, non-secret identifier of a key (first 8 characters of its SHA-256). */
export function secretBoxKeyId(key: Buffer): string {
  return createHash('sha256').update(key).digest('base64url').slice(0, 8);
}

export function sealSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    secretBoxKeyId(key),
    ...[iv, ciphertext, tag].map((b) => b.toString('base64url')),
  ].join('.');
}

/**
 * `keys`: the current key first, then the previous key during a rotation.
 * Throws if the secret is malformed, tampered with, or sealed with an unknown key.
 */
export function openSecret(sealed: string, keys: Buffer | readonly Buffer[]): string {
  const ring = Buffer.isBuffer(keys) ? [keys] : keys;
  const parts = sealed.split('.');

  if (parts[0] === VERSION && parts.length === 5) {
    const [, kid, iv, ciphertext, tag] = parts as [string, string, string, string, string];
    const key = ring.find((candidate) => secretBoxKeyId(candidate) === kid);
    if (!key) throw new Error('Sealed secret uses an unknown key');
    return decrypt(key, iv, ciphertext, tag);
  }

  if (parts[0] === 'v1' && parts.length === 4) {
    const [, iv, ciphertext, tag] = parts as [string, string, string, string];
    for (const key of ring) {
      try {
        return decrypt(key, iv, ciphertext, tag);
      } catch {
        // try the next key
      }
    }
    throw new Error('Sealed secret could not be decrypted with any configured key');
  }

  throw new Error('Unsupported or malformed sealed secret');
}

/** True when the secret should be re-sealed: old format or not under the current key. */
export function needsReseal(sealed: string, currentKey: Buffer): boolean {
  const [version, kid] = sealed.split('.');
  return version !== VERSION || kid !== secretBoxKeyId(currentKey);
}

function decrypt(key: Buffer, iv: string, ciphertext: string, tag: string): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
