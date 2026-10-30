# Environment variables

Every variable the platform reads. Real values are **never** committed — only the
`.env.example` files are tracked by git.

| File (copy from `.env.example`) | Read by                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `/.env`                         | Docker Compose (local PostgreSQL + Redis)                                    |
| `apps/api/.env`                 | NestJS API (validated at startup by `apps/api/src/config/env.validation.ts`) |
| `apps/web/.env.local`           | Next.js web app                                                              |
| `packages/database/.env`        | Prisma CLI, role bootstrap, seed, database integration tests                 |
| `--dart-define` flags           | Flutter app (see `apps/mobile/README.md`)                                    |

## Docker Compose (`/.env`)

| Variable            | Required | Default       | Description                                         |
| ------------------- | -------- | ------------- | --------------------------------------------------- |
| `POSTGRES_USER`     | yes      | —             | Superuser created in the local PostgreSQL container |
| `POSTGRES_PASSWORD` | yes      | —             | Its password (local only)                           |
| `POSTGRES_DB`       | no       | `kenisha_dev` | Database created on first start                     |
| `POSTGRES_PORT`     | no       | `5432`        | Host port (bound to 127.0.0.1)                      |
| `REDIS_PASSWORD`    | yes      | —             | Redis `requirepass`                                 |
| `REDIS_PORT`        | no       | `6379`        | Host port (bound to 127.0.0.1)                      |

## API (`apps/api/.env`)

The API refuses to start if any value is invalid. Error messages name the variable but
never print its value.

| Variable            | Required | Default                  | Description                                                                                                             |
| ------------------- | -------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`          | no       | `development`            | `development`, `test` or `production`                                                                                   |
| `API_PORT`          | no       | `4000`                   | HTTP port                                                                                                               |
| `API_GLOBAL_PREFIX` | no       | `api`                    | Route prefix → `/api/v1/...`                                                                                            |
| `CORS_ORIGINS`      | no       | `http://localhost:3000`  | Comma-separated browser origins allowed to call the API                                                                 |
| `SWAGGER_ENABLED`   | no       | `true` unless production | Serve Swagger UI at `/{prefix}/docs`                                                                                    |
| `THROTTLE_TTL_MS`   | no       | `60000`                  | Rate-limit window in ms                                                                                                 |
| `THROTTLE_LIMIT`    | no       | `120`                    | Requests allowed per window per client                                                                                  |
| `DATABASE_URL`      | **yes**  | —                        | `postgresql://…?schema=kenisha` logging in as **`kenisha_app`**. Readiness fails (503) for any role that can bypass RLS |
| `DATABASE_POOL_MAX` | no       | `10`                     | Maximum pooled database connections                                                                                     |
| `REDIS_URL`         | no       | —                        | `redis://` or `rediss://` URL (not used yet)                                                                            |

### API authentication (ADR-0003)

Generate the three secrets with `pnpm --filter @kenisha/api auth:secrets`. All are
**secrets**: never commit them, and use different values per environment.

| Variable                   | Required | Default       | Description                                                                        |
| -------------------------- | -------- | ------------- | ---------------------------------------------------------------------------------- |
| `JWT_PRIVATE_KEY`          | **yes**  | —             | Base64-encoded PEM (PKCS#8) Ed25519 key that signs access tokens. **Secret**       |
| `JWT_PUBLIC_KEY`           | **yes**  | —             | Base64-encoded PEM (SPKI) Ed25519 key that verifies them                           |
| `OTP_HMAC_SECRET`          | **yes**  | —             | ≥ 32 chars; one-time codes are stored only as HMACs keyed with it. **Secret**      |
| `SMS_PROVIDER`             | **yes**  | —             | `development` only for now (codes go to the API log; refused outside dev/test)     |
| `JWT_ISSUER`               | no       | `kenisha-api` | `iss` claim of access tokens                                                       |
| `ACCESS_TOKEN_TTL_SECONDS` | no       | `900`         | Access-token lifetime (60–3600)                                                    |
| `AUTH_COOKIE_SECURE`       | no       | `true`        | `Secure` flag on the web refresh cookie (browsers accept it on `http://localhost`) |
| `AUTH_THROTTLE_LIMIT`      | no       | `10`          | Login requests per minute per IP (in-process until Redis is introduced)            |

Rotating the JWT keys signs every user out within 15 minutes. Rotating `OTP_HMAC_SECRET`
invalidates codes that are in flight (valid for 5 minutes).

## Database package (`packages/database/.env`)

Never deployed with the API. Each role's password is read from its URL by `db:bootstrap`,
so it is configured in one place. Usernames must match the role names exactly.

| Variable                 | Used by                     | Description                                                                       |
| ------------------------ | --------------------------- | --------------------------------------------------------------------------------- |
| `DATABASE_ADMIN_URL`     | `db:bootstrap`, `test:db`   | Superuser/admin connection. Local and CI only; a DBA runs bootstrap in production |
| `MIGRATION_DATABASE_URL` | Prisma CLI (`db:migrate:*`) | `kenisha_migrator` — schema owner                                                 |
| `APP_DATABASE_URL`       | `db:seed`, `test:db`        | `kenisha_app` — same value as the API's `DATABASE_URL`                            |
| `PLATFORM_DATABASE_URL`  | `db:seed`, `test:db`        | `kenisha_platform` — Super Admin role, platform tables only                       |
| `SEED_STAFF_PASSWORD`    | `db:seed`                   | Password of every synthetic demo staff account (≥ 12 chars, local/CI only)        |

`test:db` and the API's `test:e2e:db` read the first four variables to create a throwaway
database; they never touch `kenisha_dev`.

## Web (`apps/web/.env.local`)

`NEXT_PUBLIC_*` values are compiled into browser JavaScript and are **public**.

| Variable              | Exposure    | Default                 | Description                            |
| --------------------- | ----------- | ----------------------- | -------------------------------------- |
| `API_INTERNAL_URL`    | server only | `http://localhost:4000` | API base URL used by server components |
| `NEXT_PUBLIC_API_URL` | **public**  | —                       | API base URL used from the browser     |

## Mobile (`--dart-define`)

| Key            | Default                       | Description                            |
| -------------- | ----------------------------- | -------------------------------------- |
| `API_BASE_URL` | `http://10.0.2.2:4000/api/v1` | API base URL (public)                  |
| `APP_ENV`      | `development`                 | `development`, `staging`, `production` |

## Adding a variable

1. Add it to the component's validation schema (API: `env.validation.ts`; web: `src/lib/env.server.ts`).
2. Add it to the matching `.env.example` with a safe local value or empty placeholder.
3. Document it in this file.
4. If it is a secret, add it to the production secret store (never to git, CI logs or images).
