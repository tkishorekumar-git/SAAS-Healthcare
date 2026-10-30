# Architecture overview

## System context

```
 ┌─────────────┐   ┌──────────────────┐
 │  Web (Next) │   │ Android (Flutter)│        Clients never hold DB credentials
 └──────┬──────┘   └────────┬─────────┘
        │ HTTPS             │ HTTPS
        ▼                   ▼
 ┌──────────────────────────────────────┐
 │  Caddy (TLS, HSTS, reverse proxy)    │      production only
 └──────────────────┬───────────────────┘
                    ▼
 ┌──────────────────────────────────────┐
 │  NestJS API  /api/v1                 │
 │  authn → tenant context → authz →    │
 │  validation → service → repository   │
 └───────┬───────────────────┬──────────┘
         ▼                   ▼
 ┌───────────────┐   ┌───────────────┐
 │ PostgreSQL 18 │   │   Redis 7     │
 │ RLS per tenant│   │ cache, queues │
 └───────────────┘   └───────────────┘
```

## Components

| Component                  | Responsibility                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **API** (`apps/api`)       | Single entry point for all data. Owns authentication, tenant resolution, authorization, validation, business rules, audit logging. |
| **Web** (`apps/web`)       | Staff, admin and patient portal. Server components call the API with the user's token; no direct DB access.                        |
| **Mobile** (`apps/mobile`) | Patient/guardian and field-staff app on Android. Same API, same authorization.                                                     |
| **shared**                 | TypeScript contracts (roles, module keys, response types) shared by API and web. Mobile gets contracts from the OpenAPI document.  |
| **ui**                     | Reusable shadcn/ui component library for web.                                                                                      |
| **database**               | Prisma schema, migration history, RLS policies.                                                                                    |

## Request flow (target, from Milestone 3)

1. Client sends `Authorization: Bearer <token>`.
2. Auth guard verifies the token and loads the user, role(s) and tenant membership.
3. Tenant context is derived from the session — **never** from request body/query.
4. Authorization checks role capability **and** resource ownership (tenant, branch,
   care relationship, guardian link).
5. Service runs inside a transaction that sets `app.tenant_id`; PostgreSQL RLS policies
   reject any row outside that tenant even if application code has a bug.
6. Mutations of clinical data write an audit record.

## Key decisions

- [ADR-0001](adr/0001-monorepo-and-tooling.md) — Monorepo with pnpm + Turborepo _(accepted)_
- [ADR-0002](adr/0002-tenant-isolation.md) — Shared schema + `tenant_id` + RLS _(accepted)_
- [ADR-0003](adr/0003-identity-and-access.md) — Identity, authentication and authorization _(accepted)_
- [ADR-0004](adr/0004-tenant-administration.md) — Tenant administration _(accepted)_
