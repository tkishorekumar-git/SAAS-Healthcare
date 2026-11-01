import { validateEnv } from './env.validation';

const required = {
  DATABASE_URL: 'postgresql://kenisha_app:unit-test-password@localhost:5432/test?schema=kenisha',
  JWT_PRIVATE_KEY: 'x'.repeat(64),
  JWT_PUBLIC_KEY: 'x'.repeat(64),
  OTP_HMAC_SECRET: 'unit-test-otp-secret-0123456789abcdef',
  PLATFORM_DATABASE_URL:
    'postgresql://kenisha_platform:unit-test-password@localhost:5432/test?schema=kenisha',
  PLATFORM_TOTP_KEY: Buffer.alloc(32, 7).toString('base64'),
  SMS_PROVIDER: 'development',
};

describe('validateEnv', () => {
  it('applies safe defaults when only required values are set', () => {
    const env = validateEnv(required);
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
    expect(env.API_GLOBAL_PREFIX).toBe('api');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.SWAGGER_ENABLED).toBeUndefined();
    expect(env.DATABASE_POOL_MAX).toBe(10);
  });

  it.each([
    'DATABASE_URL',
    'PLATFORM_DATABASE_URL',
    'PLATFORM_TOTP_KEY',
    'JWT_PRIVATE_KEY',
    'JWT_PUBLIC_KEY',
    'OTP_HMAC_SECRET',
    'SMS_PROVIDER',
  ])('requires %s', (name) => {
    const { [name as keyof typeof required]: _omitted, ...rest } = required;
    expect(() => validateEnv(rest)).toThrow(new RegExp(name));
  });

  it('defaults to secure auth cookies and a 15-minute access token', () => {
    const env = validateEnv(required);
    expect(env.AUTH_COOKIE_SECURE).toBe(true);
    expect(env.ACCESS_TOKEN_TTL_SECONDS).toBe(900);
  });

  it('parses comma-separated CORS origins and string booleans', () => {
    const env = validateEnv({
      ...required,
      CORS_ORIGINS: 'https://app.example.test, https://admin.example.test',
      SWAGGER_ENABLED: 'false',
      API_PORT: '8080',
    });
    expect(env.CORS_ORIGINS).toEqual(['https://app.example.test', 'https://admin.example.test']);
    expect(env.SWAGGER_ENABLED).toBe(false);
    expect(env.API_PORT).toBe(8080);
  });

  it('rejects invalid values without echoing them', () => {
    const secret = 'mysql://root:super-secret@db';
    expect(() => validateEnv({ DATABASE_URL: secret })).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ DATABASE_URL: secret })).not.toThrow(/super-secret/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => validateEnv({ ...required, API_PORT: '70000' })).toThrow(/API_PORT/);
  });

  describe('deployments (ADR-0006)', () => {
    const production = { ...required, NODE_ENV: 'production' };

    it('requires Redis in production so rate limits survive restarts', () => {
      expect(() => validateEnv({ ...production, DEPLOYMENT_ENV: 'staging' })).toThrow(/REDIS_URL/);
      expect(
        validateEnv({ ...production, DEPLOYMENT_ENV: 'staging', REDIS_URL: 'redis://r:6379' })
          .REDIS_URL,
      ).toBe('redis://r:6379');
    });

    it('never allows the SMS stub in the production deployment', () => {
      expect(() =>
        validateEnv({ ...production, DEPLOYMENT_ENV: 'production', REDIS_URL: 'redis://r:6379' }),
      ).toThrow(/SMS_PROVIDER/);
    });

    it('requires a named deployment when NODE_ENV is production', () => {
      expect(() => validateEnv({ ...production, REDIS_URL: 'redis://r:6379' })).toThrow(
        /DEPLOYMENT_ENV/,
      );
    });

    it('trusts no proxy unless told to', () => {
      expect(validateEnv(required).TRUST_PROXY_HOPS).toBe(0);
      expect(validateEnv({ ...required, TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS).toBe(1);
    });
  });
});
