import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((value) => value === 'true');

/**
 * Every environment variable the API reads. The process refuses to start if
 * any value is invalid, so misconfiguration fails fast instead of at runtime.
 * Keep docs/environment.md in sync with this schema.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  API_GLOBAL_PREFIX: z
    .string()
    .regex(/^[a-z0-9-]+$/, 'must be a single lowercase path segment')
    .default('api'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  SWAGGER_ENABLED: booleanString.optional(),
  /** Public URL of the web app; staff invitation links point here. */
  WEB_APP_URL: z.url().default('http://localhost:3000'),
  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(120),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// connection string'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** Super Admin endpoints connect as kenisha_platform (no access to hospital data). */
  PLATFORM_DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgresql:// connection string'),
  /** Base64-encoded 32-byte key that encrypts Super Admin authenticator secrets. */
  PLATFORM_TOTP_KEY: z.string().min(40, 'must be a base64-encoded 32-byte key'),
  /** Only during a key rotation: the previous key, to read secrets not yet re-encrypted. */
  PLATFORM_TOTP_KEY_PREVIOUS: z.string().min(40).optional(),
  /** How often expired codes, sessions and invitations are deleted; 0 disables (ADR-0005). */
  AUTH_DATA_PURGE_INTERVAL_MINUTES: z.coerce.number().int().min(0).max(1440).default(60),
  REDIS_URL: z
    .string()
    .regex(/^rediss?:\/\//, 'must be a redis:// or rediss:// URL')
    .optional(),

  // Authentication (ADR-0003). Generate with `pnpm --filter @kenisha/api auth:secrets`.
  /** Base64-encoded PEM (PKCS#8) Ed25519 private key. */
  JWT_PRIVATE_KEY: z.string().min(40, 'must be a base64-encoded Ed25519 private key'),
  /** Base64-encoded PEM (SPKI) Ed25519 public key. */
  JWT_PUBLIC_KEY: z.string().min(40, 'must be a base64-encoded Ed25519 public key'),
  /**
   * Only during a key rotation: the previous public key, so access tokens signed before the
   * switch stay valid until they expire (docs/security/runbooks/secret-rotation.md).
   */
  JWT_PREVIOUS_PUBLIC_KEY: z.string().min(40).optional(),
  JWT_ISSUER: z.string().min(1).default('kenisha-api'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  OTP_HMAC_SECRET: z.string().min(32, 'must be at least 32 characters'),
  SMS_PROVIDER: z.enum(['development']),
  AUTH_COOKIE_SECURE: booleanString.default(true),
  /** Requests per minute per IP on login endpoints (in-process until Redis is added). */
  AUTH_THROTTLE_LIMIT: z.coerce.number().int().positive().default(10),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    // Report variable names and rules only — never echo values, which may be secrets.
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  return result.data;
}
