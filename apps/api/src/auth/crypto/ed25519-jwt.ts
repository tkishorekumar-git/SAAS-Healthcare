import {
  type KeyObject,
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from 'node:crypto';

/**
 * Minimal JWT (RFC 7519) signer/verifier for Ed25519 using only Node's crypto module.
 * The verifier accepts exactly one algorithm (EdDSA) — "alg: none" and HMAC/RSA
 * confusion attacks are impossible by construction.
 */
export class InvalidTokenError extends Error {
  constructor(reason: string) {
    super(`Invalid token: ${reason}`);
    this.name = 'InvalidTokenError';
  }
}

/** A public key and its ID (`kid` header), so a previous key can verify during rotation. */
export interface VerificationKey {
  kid: string;
  key: KeyObject;
}

/** Stable ID of a public key: the first 16 characters of the SHA-256 of its SPKI encoding. */
export function keyId(publicKey: KeyObject): string {
  return createHash('sha256')
    .update(publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64url')
    .slice(0, 16);
}

/** Loads one base64-encoded PEM (SPKI) Ed25519 public key. */
export function loadEd25519PublicKey(publicKeyBase64: string): KeyObject {
  let publicKey: KeyObject;
  try {
    publicKey = createPublicKey(Buffer.from(publicKeyBase64, 'base64').toString('utf8'));
  } catch {
    throw new Error('JWT public key is not a valid base64-encoded PEM key');
  }
  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('JWT keys must be Ed25519');
  }
  return publicKey;
}

export interface JwtTimeClaims {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
}

export function loadEd25519Keys(
  privateKeyBase64: string,
  publicKeyBase64: string,
): {
  privateKey: KeyObject;
  publicKey: KeyObject;
} {
  const decode = (value: string) => Buffer.from(value, 'base64').toString('utf8');
  let privateKey: KeyObject;
  let publicKey: KeyObject;
  try {
    privateKey = createPrivateKey(decode(privateKeyBase64));
    publicKey = createPublicKey(decode(publicKeyBase64));
  } catch {
    throw new Error('JWT_PRIVATE_KEY / JWT_PUBLIC_KEY are not valid base64-encoded PEM keys');
  }
  if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('JWT keys must be Ed25519');
  }
  // A half-finished rotation (new private key, old public key) must fail at start-up.
  if (keyId(createPublicKey(privateKey)) !== keyId(publicKey)) {
    throw new Error('JWT_PUBLIC_KEY does not belong to JWT_PRIVATE_KEY');
  }
  return { privateKey, publicKey };
}

export function signJwt(payload: object, privateKey: KeyObject, kid?: string): string {
  const header = Buffer.from(
    JSON.stringify(kid ? { alg: 'EdDSA', typ: 'JWT', kid } : { alg: 'EdDSA', typ: 'JWT' }),
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${header}.${body}`;
  const signature = sign(null, Buffer.from(signingInput), privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

export interface VerifyOptions {
  issuer: string;
  audiences: readonly string[];
  nowSeconds?: number;
}

/**
 * `keys`: one key, or the current key first followed by the previous one during a rotation.
 * A token naming an unknown `kid` is rejected; a token without `kid` (issued before kids
 * existed) is checked against the current key only.
 */
export function verifyJwt(
  token: string,
  keys: KeyObject | readonly VerificationKey[],
  options: VerifyOptions,
): Record<string, unknown> & JwtTimeClaims {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new InvalidTokenError('malformed');
  }
  const [header, body, signature] = parts as [string, string, string];

  let parsedHeader: unknown;
  try {
    parsedHeader = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidTokenError('malformed header');
  }
  if (
    typeof parsedHeader !== 'object' ||
    parsedHeader === null ||
    (parsedHeader as { alg?: unknown }).alg !== 'EdDSA'
  ) {
    throw new InvalidTokenError('unsupported algorithm');
  }
  const publicKey = selectKey(keys, (parsedHeader as { kid?: unknown }).kid);

  const valid = verify(
    null,
    Buffer.from(`${header}.${body}`),
    publicKey,
    Buffer.from(signature, 'base64url'),
  );
  if (!valid) {
    throw new InvalidTokenError('bad signature');
  }

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    throw new InvalidTokenError('malformed payload');
  }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (claims.iss !== options.issuer) {
    throw new InvalidTokenError('wrong issuer');
  }
  if (typeof claims.aud !== 'string' || !options.audiences.includes(claims.aud)) {
    throw new InvalidTokenError('wrong audience');
  }
  if (typeof claims.exp !== 'number' || claims.exp <= now) {
    throw new InvalidTokenError('expired');
  }
  if (typeof claims.iat !== 'number' || claims.iat > now + 60) {
    throw new InvalidTokenError('issued in the future');
  }
  return claims as Record<string, unknown> & JwtTimeClaims;
}

function selectKey(keys: KeyObject | readonly VerificationKey[], kid: unknown): KeyObject {
  if (!Array.isArray(keys)) return keys as KeyObject;
  const list = keys as readonly VerificationKey[];
  if (kid === undefined) {
    const current = list[0];
    if (!current) throw new InvalidTokenError('no verification key');
    return current.key;
  }
  const match = list.find((entry) => entry.kid === kid);
  if (!match) throw new InvalidTokenError('unknown key');
  return match.key;
}
