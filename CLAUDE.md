# CLAUDE.md — Kenisha Healthcare

Instructions for Claude Code (and human contributors) working in this repository.

## What this is

Kenisha Healthcare is a commercial, multi-tenant SaaS healthcare platform for India and
international markets. Four integrated modules: Hospital Management, Chronic Disease
Management, Maternal & Pregnancy Care, Newborn & Pediatric Care (birth–10 years).
Clients: Next.js web app and Flutter Android app, both backed by one NestJS REST API.

Current milestone and roadmap: [docs/roadmap.md](docs/roadmap.md).

## Repository map

| Path                                          | Purpose                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `apps/api`                                    | NestJS REST API (`@kenisha/api`) — the only component that touches the database             |
| `apps/web`                                    | Next.js App Router web app (`@kenisha/web`)                                                 |
| `apps/mobile`                                 | Flutter Android app (not a pnpm workspace package)                                          |
| `packages/shared`                             | Framework-agnostic types/constants (`@kenisha/shared`), built with tsup                     |
| `packages/ui`                                 | shadcn/ui React components (`@kenisha/ui`), consumed as source                              |
| `packages/database`                           | Prisma 7 schema, append-only migrations, RLS policies, `withTenant()` (`@kenisha/database`) |
| `packages/tsconfig`, `packages/eslint-config` | Shared strict tooling config                                                                |
| `docs/`                                       | Architecture, ADRs, security, environment reference                                         |

## Commands

Package manager is **pnpm** (via corepack). Run from the repo root.

```bash
pnpm install            # install everything
pnpm infra:up           # start PostgreSQL + Redis (Docker)
pnpm dev                # API (4000) + web (3000) + shared watcher
pnpm check              # format check, lint, typecheck, unit + e2e tests — run before finishing work
pnpm test:db             # tenant-isolation tests on real PostgreSQL
pnpm test:e2e:db         # API auth/permission flows on real PostgreSQL
pnpm db:bootstrap        # create DB roles (once per database)
pnpm db:migrate:deploy   # apply migrations; pnpm db:seed for synthetic data
pnpm --filter @kenisha/api test       # one package
```

Flutter: `cd apps/mobile && flutter analyze && flutter test`.

## Non-negotiable rules

1. **One milestone at a time.** Never build the whole platform in one pass. Stop and ask
   for approval at the end of each milestone.
2. **Ask before major architectural changes** (new service, datastore, framework, auth model,
   tenancy model, major dependency). Record approved decisions as an ADR in
   `docs/architecture/adr/`.
3. **Security review before any clinical feature** — see `docs/security.md`.
4. **Tenant isolation is mandatory.** Every tenant-owned row has `tenant_id`; every query is
   tenant-scoped; PostgreSQL RLS is the backstop. Never accept `tenant_id` from a request
   body — derive it from the authenticated session.
5. **Clients never touch the database.** Web and Android go through the API only. No DB
   URLs, credentials or service keys in frontend or mobile code. `NEXT_PUBLIC_*` and
   `--dart-define` values are public.
6. **No secrets in git.** Only `.env.example` files are committed. Document every new
   variable in `docs/environment.md` and the relevant `.env.example`.
7. **Synthetic data only** in seeds, fixtures, tests, screenshots and docs. Never real
   patient data.
8. **No PHI in logs**, error messages, analytics or URLs. Log IDs, not names/diagnoses.
9. **Migrations are append-only.** New migration per change; never edit a merged migration.
10. **TypeScript strict mode** everywhere; no `any`; validate all external input
    (DTOs with class-validator in the API, zod for env/config).
11. **Tests with every change** — unit tests for logic, e2e tests for API endpoints,
    widget tests for Flutter.

## Conventions

- API routes are versioned: `/api/v1/...`. Swagger at `/api/docs` (non-production).
- API modules follow Nest feature folders: `src/<feature>/{module,controller,service,dto}`.
- Shared request/response contracts live in `packages/shared` and are implemented by
  Swagger DTO classes in the API.
- Web consoles call the API through `staffSession` / `platformSession` (`apps/web/src/lib/auth`);
  never store tokens in browser storage and never call `/auth/refresh` directly.
- Add shadcn components into `packages/ui/src/components/` and import them as
  `@kenisha/ui/components/<name>`.
- Roles are defined once in `packages/shared/src/roles.ts`; the role → permission map in
  `packages/shared/src/permissions.ts`.
- **Every endpoint is authenticated by default.** Mark genuinely public endpoints with
  `@Public()`; protect the rest with `@RequirePermissions(...)` and read the caller with
  `@CurrentAuth()`. Tenant ID always comes from `CurrentAuth`, never from the request.
- Super Admin endpoints live under `/platform`, are marked `@PlatformRoute()` and use only
  `PlatformDatabase` (kenisha_platform) — never `TenantDatabase`.
- Anything that consumes plan capacity (staff, branches) calls `PlanLimitsService.assert*`
  inside the same transaction as the change.
- Feature code reaches the database only through `TenantDatabase.run(tenantId, tx => …)`.
- Security-relevant actions write an audit event (`AuditService.record`) in the same
  transaction — IDs and reason codes only, never codes, tokens, passwords or PHI.
- Error messages on login paths stay generic: never reveal whether a hospital, account or
  phone number exists.
- Use the Nest `Logger`, never `console.log` (ESLint enforces this).
- Conventional commits: `feat(api): ...`, `fix(web): ...`, `chore: ...`.
