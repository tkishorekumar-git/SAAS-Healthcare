# Roadmap

Each milestone ends with a review and explicit approval before the next one starts.

| #   | Milestone                                                                                                                                                          | Status                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| 1   | **Monorepo foundation** — apps, shared packages, tooling, Docker dev env, CI, docs                                                                                 | ✅ Complete                             |
| 2   | **Database foundation** — Prisma, tenancy tables (tenants, branches, subscriptions), RLS, migrations, synthetic seed, readiness check                              | ✅ Complete                             |
| 3a  | **Identity & access (hospital users)** — hospital-first login, patient SMS-code login, staff password + SMS factor, sessions, permissions, branch scope, audit log | ✅ Complete — awaiting approval         |
| 3b  | **Identity & access (platform)** — Super Admin login with authenticator app, break-glass support access                                                            | Next                                    |
| 4   | **Tenant administration** — Super Admin console, hospital onboarding, branches, staff, subscriptions                                                               | Planned                                 |
| 5   | **Security review gate** — threat model, pen-test checklist, logging/PHI review                                                                                    | Planned (required before clinical work) |
| 6   | **Patient registry** — patients, guardians, consent, shared clinical foundations                                                                                   | Planned                                 |
| 7+  | Clinical modules — Hospital Management, Chronic Care, Maternal, Pediatric                                                                                          | Planned                                 |
| —   | **Deployment** — production Dockerfiles, Caddy, Hostinger VPS, automated backups, monitoring                                                                       | Scheduled alongside milestones 3–5      |

## Milestone 2 deliverables

- `@kenisha/database`: Prisma 7 schema and client (pg driver adapter), PostgreSQL 18, UUIDv7 keys.
- Tables: `tenants`, `branches`, `subscription_plans`, `tenant_subscriptions`.
- Three least-privilege roles (`kenisha_migrator`, `kenisha_app`, `kenisha_platform`) with
  forced RLS on every table; the platform role has no access to tenant-owned data.
- `withTenant()` transaction helper; API `TenantDatabase` service is the only DB access for features.
- `GET /api/v1/health/ready`: 503 if the database is down **or** the API connects as a role
  that can bypass RLS.
- 17 integration tests proving cross-tenant isolation (also through raw SQL); CI runs them on
  PostgreSQL 18 together with a migration-drift check.
- Idempotent synthetic seed (2 demo hospitals, 3 plans).

## Milestone 3a deliverables

- 7 identity tables (users, roles, branch assignments, password credentials, one-time codes,
  sessions, audit events) with forced RLS, composite foreign keys and column-level grants.
- `resolve_tenant()` pre-login hospital lookup that reveals only ID + active flag.
- Patient/guardian SMS-code login; staff password (Argon2id) + SMS second factor with
  hospital-configurable scope; account lockout; generic errors (no account enumeration).
- Ed25519 access tokens (15 min) and rotating refresh tokens with replay detection;
  HttpOnly cookie on web; immediate revocation on logout, theft or disabled account.
- Deny-by-default guard, role → permission map, branch scope (ADR-0002 D3), audit log API.
- 18 new database isolation tests, 19 API end-to-end tests on PostgreSQL, unit tests for
  JWT/codes/tokens/passwords; mutation-checked.
