# @kenisha/database

PostgreSQL 18 schema, migration history, Row-Level Security (RLS) policies and the
tenant-aware Prisma 7 client. Design: [ADR-0002](../../docs/architecture/adr/0002-tenant-isolation.md).

## Layout

```
packages/database/
├── prisma/
│   ├── schema.prisma          # Data model (tables only — RLS lives in migrations)
│   └── migrations/            # Append-only migration history (committed)
├── prisma.config.ts           # Prisma CLI config — connects as kenisha_migrator
├── scripts/
│   ├── bootstrap-roles.ts     # Creates the three database roles + schema (run once per DB)
│   └── seed.ts                # SYNTHETIC demo data, written through the RLS-restricted roles
├── src/
│   ├── client.ts              # createPrismaClient(url)
│   ├── tenant.ts              # withTenant(prisma, tenantId, work)
│   ├── role-check.ts          # checkConnectionRole() — refuses roles that bypass RLS
│   ├── bootstrap.ts           # Role/schema bootstrap logic
│   └── generated/             # Prisma client (git-ignored; `prisma generate`)
└── test/                      # Tenant-isolation integration tests (real PostgreSQL)
```

## Database roles

| Role               | Used by                   | Can do                                                                                                                                                               |
| ------------------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kenisha_migrator` | Prisma CLI (migrations)   | Owns the `kenisha` schema and every table. Never used by running services.                                                                                           |
| `kenisha_app`      | NestJS API                | Tenant data **only for the tenant set by `withTenant()`**. No DELETE.                                                                                                |
| `kenisha_platform` | API `/platform` endpoints | Tenants, plans, subscriptions, platform users/sessions/audit; may _create_ support access requests but never approve them. **No privileges on tenant-owned tables.** |

All three are `NOSUPERUSER NOBYPASSRLS`. Every table has RLS **enabled and forced**.

The schema name is fixed as `kenisha`: the `resolve_tenant()` security-definer function
references `kenisha.tenants` explicitly so it cannot be hijacked through `search_path`.

## Local setup

Requires PostgreSQL 18 (`pnpm infra:up` starts it in Docker).

```bash
cp packages/database/.env.example packages/database/.env   # local values only
pnpm db:bootstrap        # create roles + schema (re-run to rotate passwords)
pnpm db:migrate:deploy   # apply migrations
pnpm db:seed             # synthetic demo hospitals (idempotent)
```

Then set `DATABASE_URL` in `apps/api/.env` to the same value as `APP_DATABASE_URL`.

## Using the database from the API

Feature modules inject `TenantDatabase` (from `apps/api/src/database`) and never the raw client:

```ts
const branches = await this.db.run(session.tenantId, (tx) => tx.branch.findMany());
```

`run()` opens a transaction, sets `app.tenant_id` for that transaction only, and runs the
work. Outside `run()` the API role sees **no** tenant rows.

## Changing the schema — the rules

1. Edit `schema.prisma`, then create a migration **without applying it**:
   `pnpm --filter @kenisha/database exec prisma migrate dev --create-only --name <change>`.
2. Append a **security block** to the generated `migration.sql` for every new table:
   - Tenant-owned table: `tenant_id uuid NOT NULL` FK to `tenants`, `ENABLE` + `FORCE ROW LEVEL SECURITY`,
     explicit `GRANT`s to `kenisha_app` (column-level `UPDATE`, no `tenant_id`), and a policy
     `USING/WITH CHECK ("tenant_id" = (SELECT "current_tenant_id"()))`.
     Reference other tenant rows with composite FKs `(tenant_id, x_id)`.
   - Platform table: grants to `kenisha_platform`; grant `kenisha_app` only what tenants must read.
   - **Never** grant anything on tenant-owned tables to `kenisha_platform` (ADR-0002, D2).
3. Add integration tests in `test/` proving the new table is isolated.
4. Apply with `pnpm db:migrate:dev`, run `pnpm test:db`.
5. Wrap hand-written migrations in `BEGIN;` … `COMMIT;`. Prisma does **not** run a migration
   in a transaction, so a failure part-way would leave tables without their RLS policies.
   Keep migration files **ASCII-only** (some servers are not UTF-8).
6. Migrations are **never edited after merge** — fix forward with a new migration.
7. Production applies migrations with `pnpm db:migrate:deploy` only (never `migrate dev`/`db push`).
8. Destructive changes (drop/rename column) use expand → migrate → contract across releases.
9. Data backfills run as a role with an explicit policy; the owner role is subject to forced RLS too.

CI fails if `migration.sql` and `schema.prisma` drift apart.

## Integration tests

`pnpm test:db` creates a throwaway database on the server in `DATABASE_ADMIN_URL`, bootstraps
roles, applies all migrations, runs the isolation suite, and drops the database. It needs the
four URLs from `.env` (or CI environment). It does not touch your `kenisha_dev` data.
