import { createHmac, generateKeyPairSync } from 'node:crypto';
import { InvalidTokenError, loadEd25519Keys, signJwt, verifyJwt } from './ed25519-jwt';

function keyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const b64 = (pem: string) => Buffer.from(pem).toString('base64');
  return loadEd25519Keys(
    b64(privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()),
    b64(publicKey.export({ type: 'spki', format: 'pem' }).toString()),
  );
}

const keys = keyPair();
const NOW = 1_800_000_000;
const options = { issuer: 'kenisha-api', audiences: ['web', 'mobile'], nowSeconds: NOW };
const claims = { iss: 'kenisha-api', aud: 'web', sub: 'user-1', iat: NOW, exp: NOW + 900 };

const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('Ed25519 JWT', () => {
  it('round-trips signed claims', () => {
    const token = signJwt(claims, keys.privateKey);
    expect(verifyJwt(token, keys.publicKey, options)).toMatchObject({ sub: 'user-1' });
  });

  it('rejects a token whose payload was altered', () => {
    const [header, , signature] = signJwt(claims, keys.privateKey).split('.');
    const forged = `${header}.${b64url({ ...claims, sub: 'admin' })}.${signature}`;
    expect(() => verifyJwt(forged, keys.publicKey, options)).toThrow(/bad signature/);
  });

  it('rejects a token signed with a different key', () => {
    const other = keyPair();
    expect(() => verifyJwt(signJwt(claims, other.privateKey), keys.publicKey, options)).toThrow(
      InvalidTokenError,
    );
  });

  it('rejects "alg: none"', () => {
    const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims)}.`;
    expect(() => verifyJwt(token, keys.publicKey, options)).toThrow(/unsupported algorithm/);
  });

  it('rejects HMAC tokens signed with the public key as secret (algorithm confusion)', () => {
    const header = b64url({ alg: 'HS256', typ: 'JWT' });
    const body = b64url(claims);
    const secret = keys.publicKey.export({ type: 'spki', format: 'pem' });
    const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    expect(() => verifyJwt(`${header}.${body}.${signature}`, keys.publicKey, options)).toThrow(
      /unsupported algorithm/,
    );
  });

  it.each([
    ['expired', { exp: NOW }],
    ['wrong issuer', { iss: 'someone-else' }],
    ['wrong audience', { aud: 'platform' }],
    ['issued in the future', { iat: NOW + 3600 }],
  ])('rejects tokens that are %s', (reason, override) => {
    const token = signJwt({ ...claims, ...override }, keys.privateKey);
    expect(() => verifyJwt(token, keys.publicKey, options)).toThrow(reason);
  });

  it('rejects malformed input', () => {
    expect(() => verifyJwt('not-a-jwt', keys.publicKey, options)).toThrow(/malformed/);
  });

  it('refuses non-Ed25519 keys at startup', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const b64 = (pem: string) => Buffer.from(pem).toString('base64');
    expect(() =>
      loadEd25519Keys(
        b64(rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()),
        b64(rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString()),
      ),
    ).toThrow(/Ed25519/);
  });
});
