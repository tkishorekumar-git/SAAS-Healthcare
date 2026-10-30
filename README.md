# Kenisha Healthcare

A multi-tenant SaaS healthcare platform for hospitals and clinics in India and international
markets, with a web application and an Android application.

| Module                     | Scope                                                          |
| -------------------------- | -------------------------------------------------------------- |
| Hospital Management        | Branches, staff, OPD/IPD, appointments, billing, lab, pharmacy |
| Chronic Disease Management | Long-term care plans and monitoring                            |
| Maternal & Pregnancy Care  | Antenatal, delivery planning, postnatal follow-up              |
| Newborn & Pediatric Care   | Growth, development and immunisation, birth to 10 years        |

> **Status: Milestone 1 — monorepo foundation.** No clinical modules or database tables exist
> yet. See [docs/roadmap.md](docs/roadmap.md).

## Tech stack

| Layer          | Technology                                                               |
| -------------- | ------------------------------------------------------------------------ |
| Web            | Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4, shadcn/ui |
| API            | NestJS 11, Node.js 24, REST, Swagger/OpenAPI, class-validator, zod       |
| Database       | PostgreSQL 18 with Row-Level Security, Prisma ORM (Milestone 2)          |
| Cache / queues | Redis 7.4                                                                |
| Android        | Flutter, Dart                                                            |
| Tooling        | pnpm workspaces, Turborepo, ESLint 9, Prettier, Jest, Vitest             |
| Infrastructure | Docker, Caddy, Hostinger VPS, GitHub Actions                             |

## Repository structure

```
kenisha-healthcare/
├── apps/
│   ├── api/                  NestJS REST API (port 4000)
│   │   ├── src/
│   │   │   ├── bootstrap/    Security headers, CORS, validation, versioning, Swagger
│   │   │   ├── config/       Environment schema (fail-fast validation)
│   │   │   ├── health/       GET /api/v1/health
│   │   │   ├── app.module.ts
│   │   │   └── main.ts
│   │   └── test/             End-to-end tests (supertest)
│   ├── web/                  Next.js web app (port 3000)
│   │   └── src/{app,components,lib}
│   └── mobile/               Flutter Android app (see apps/mobile/README.md)
├── packages/
│   ├── shared/               Shared TS types/constants (roles, modules, contracts)
│   ├── ui/                   shadcn/ui component library
│   ├── database/             Prisma schema, migrations, RLS SQL (Milestone 2)
│   ├── tsconfig/             Strict TypeScript presets
│   └── eslint-config/        ESLint flat-config presets
├── docs/                     Architecture, ADRs, security, environment, deployment
├── .github/                  CI workflow, PR template, Dependabot
├── docker-compose.yml        Local PostgreSQL + Redis
├── CLAUDE.md                 Project rules for Claude Code and contributors
└── turbo.json                Task pipeline
```

## Prerequisites

| Tool                         | Version             | Install                                                                   |
| ---------------------------- | ------------------- | ------------------------------------------------------------------------- |
| Node.js                      | 24 LTS (≥ 22.12)    | <https://nodejs.org> or `nvm use`                                         |
| pnpm                         | 9.15 (via corepack) | `corepack enable`                                                         |
| Docker Desktop               | latest              | <https://www.docker.com/products/docker-desktop>                          |
| Git                          | latest              | <https://git-scm.com>                                                     |
| Flutter SDK + Android Studio | latest stable       | Only for mobile work — see [apps/mobile/README.md](apps/mobile/README.md) |

On Windows, if `corepack enable` fails with a permissions error, run it from an
administrator terminal once, or prefix commands with `corepack` (e.g. `corepack pnpm install`).

## Setup

```bash
# 1. Install dependencies
corepack enable
pnpm install

# 2. Create local environment files (local-only values; never commit the copies)
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
cp packages/database/.env.example packages/database/.env

# 3. Start PostgreSQL and Redis
pnpm infra:up
pnpm infra:ps        # both services should report "healthy"

# 4. Create database roles, apply migrations, load synthetic demo data
pnpm db:bootstrap
pnpm db:migrate:deploy
pnpm db:seed

# 5. Generate API signing keys and the code secret; paste the output into apps/api/.env
pnpm --filter @kenisha/api auth:secrets
```

The database setup and the rules for schema changes are in
[packages/database/README.md](packages/database/README.md). Redis is not used yet.

### Demo logins (synthetic data from `db:seed`)

Hospital code **`demo-aarogya`**. In development, login codes are not sent by SMS — they
appear in the API log as `[DEV ONLY] code for ******0002: 123456`.

| Who                      | Endpoint                        | Identifier                                            |
| ------------------------ | ------------------------------- | ----------------------------------------------------- |
| Hospital Admin           | `POST /api/v1/auth/staff/login` | `admin@aarogya.example.test` + `SEED_STAFF_PASSWORD`  |
| Doctor (assigned: NORTH) | `POST /api/v1/auth/staff/login` | `doctor@aarogya.example.test` + `SEED_STAFF_PASSWORD` |
| Nurse (assigned: MAIN)   | `POST /api/v1/auth/staff/login` | `nurse@aarogya.example.test` + `SEED_STAFF_PASSWORD`  |
| Patient & guardian       | `POST /api/v1/auth/otp/request` | `+919800000101`                                       |

Staff then complete `POST /api/v1/auth/staff/mfa/verify` with the code from the log.
The full flow is documented in Swagger under **auth**.

## Running locally

```bash
pnpm dev             # API + web + shared-package watcher
pnpm dev:api         # API only
pnpm dev:web         # web only
```

| URL                                         | What                                                           |
| ------------------------------------------- | -------------------------------------------------------------- |
| <http://localhost:3000>                     | Web app — shows API online/offline status and the four modules |
| <http://localhost:4000/api/v1/health>       | API liveness check                                             |
| <http://localhost:4000/api/v1/health/ready> | Readiness — database reachable as a least-privilege role       |
| <http://localhost:4000/api/docs>            | Swagger UI                                                     |
| <http://localhost:4000/api/docs-json>       | OpenAPI document (for client generation)                       |

Mobile: see [apps/mobile/README.md](apps/mobile/README.md).

## Testing and quality

```bash
pnpm check           # everything CI runs: format, lint, typecheck, unit + e2e tests
pnpm test            # unit tests (Jest for API, Vitest for web and shared)
pnpm test:e2e        # API end-to-end tests
pnpm test:db         # tenant-isolation tests against real PostgreSQL (needs packages/database/.env)
pnpm test:e2e:db     # API login/session/permission flows against real PostgreSQL
pnpm lint
pnpm typecheck
pnpm format          # auto-format with Prettier
pnpm build           # production builds of every package

pnpm --filter @kenisha/api test:cov   # API coverage report
```

Flutter (from `apps/mobile`): `flutter analyze` and `flutter test`.

## Environment configuration

Each component has a committed `.env.example`; real `.env` files are git-ignored.
Every variable is documented in [docs/environment.md](docs/environment.md). The API
validates its environment at startup and refuses to start on invalid values.

**Never** put secrets in `NEXT_PUBLIC_*` variables or Flutter `--dart-define` values —
both end up in code shipped to users.

## Infrastructure commands

```bash
pnpm infra:up        # start PostgreSQL 18 + Redis 7.4
pnpm infra:down      # stop (data volumes are kept)
pnpm infra:logs      # follow logs
docker compose down -v   # stop AND delete local data volumes
```

## Development principles

The full list is in [CLAUDE.md](CLAUDE.md). In short: one milestone at a time, strict
TypeScript, tests with every change, synthetic data only, no secrets in git, clients
never touch the database, tenant isolation enforced in both the API and PostgreSQL RLS,
security review before clinical features, and approval for architectural changes.

## Documentation

See [docs/README.md](docs/README.md).

## License

Proprietary — © Kenisha Healthcare. All rights reserved.
