import { type KeyObject, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

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

const HEADER = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');

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
  return { privateKey, publicKey };
}

export function signJwt(payload: object, privateKey: KeyObject): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signingInput = `${HEADER}.${body}`;
  const signature = sign(null, Buffer.from(signingInput), privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

export interface VerifyOptions {
  issuer: string;
  audiences: readonly string[];
  nowSeconds?: number;
}

export function verifyJwt(
  token: string,
  publicKey: KeyObject,
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
