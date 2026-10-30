# ADR-0002: Tenant isolation — shared schema, `tenant_id`, PostgreSQL RLS

- **Status:** Accepted — approved by product owner 2026-10-30; implemented in Milestone 2
- **Date:** 2026-10-30

## Context

Each hospital (tenant) must have independent branches, staff, patients, clinical records,
billing and subscription. A cross-tenant data leak of health records is the most severe
failure this platform can have.

## Options considered

| Option                                   | Isolation                  | Ops cost at 100s of tenants            | Cross-tenant reporting (Super Admin) |
| ---------------------------------------- | -------------------------- | -------------------------------------- | ------------------------------------ |
| A. Database per tenant                   | Strongest                  | High (migrations × N, connections × N) | Hard                                 |
| B. Schema per tenant                     | Strong                     | Medium–high (migration fan-out)        | Hard                                 |
| **C. Shared schema + `tenant_id` + RLS** | Strong when enforced in DB | Low                                    | Easy, controlled                     |

## Product decisions (2026-10-30)

| #   | Question                                   | Decision                                                                                           |
| --- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| D1  | Patient seen at two hospitals              | **Fully separate per hospital** — separate account and separate record at each hospital            |
| D2  | Super Admin access to patient data (PHI)   | **No PHI access**; emergency support only via time-limited, audited, hospital-approved break-glass |
| D3  | Branch-level restriction within a hospital | **Configurable per hospital** — all branches, or assigned branches only                            |
| D4  | Data residency                             | **India-only deployment for now**; add regional deployments when a market legally requires it      |

## Proposed decision: Option C, defence in depth

### Database enforcement

1. Every tenant-owned table has a non-null `tenant_id` (FK to `tenants`), indexed, and is
   part of composite unique keys (e.g. `(tenant_id, mrn)`).
2. **RLS enabled and forced** (`ENABLE` + `FORCE ROW LEVEL SECURITY`) on every tenant-owned
   table, with policies
   `USING (tenant_id = current_setting('app.tenant_id', true)::uuid)` and the same `WITH CHECK`.
   The `true` flag makes a missing setting return `NULL`, so the policy matches no rows
   (fail closed) instead of raising an error.
3. The API connects as a dedicated role `kenisha_app` that is **not** a superuser, **not** the
   table owner and has `NOBYPASSRLS`. Migrations run as a separate `kenisha_migrator` owner role.
4. Each request runs its queries in a transaction that first executes
   `SELECT set_config('app.tenant_id', $1, true)` (transaction-local, safe with pooling).
5. Primary keys are UUIDv7 (`uuidv7()` is native in PostgreSQL 18): globally unique,
   time-ordered, and safe to expose in URLs.

### Identity (D1)

6. **All user accounts are tenant-scoped**, including patients and parents/guardians: the
   `users` table has `tenant_id` and RLS like any clinical table. Phone and email are unique
   **per tenant** — the same phone number may hold separate accounts at two hospitals.
7. Because credentials are not globally unique, **login must identify the hospital first**:
   a hospital subdomain on web (`<hospital>.kenisha…`) or a hospital code / hospital picker in
   the Android app. The tenant is fixed in the session at login and cannot change mid-session.
8. Platform staff (Super Admin) live in a separate `platform_users` table with no `tenant_id`,
   a separate login path, and mandatory MFA. They are never rows in a tenant's `users` table.
9. Tenant ID is derived only from the authenticated session, never from client input.

### Super Admin (D2)

10. Super Admin uses a separate database role (`kenisha_platform`) that can read and write
    **platform tables only** (tenants, subscriptions, plans, invoices, usage counters). It is
    granted **no privileges** on clinical or patient tables, so PHI access is blocked by the
    database, not only by API code.
11. **Break-glass:** for a support incident, a Hospital Admin approves a time-limited grant
    (e.g. max 4 hours) scoped to their tenant. During the grant the Super Admin acts through the
    normal tenant path (`kenisha_app` + that `tenant_id`); every request is written to an
    append-only audit log visible to the hospital. Grants expire automatically.

### Branches (D3)

12. Each tenant has a setting `branch_scope_mode`: `TENANT_WIDE` or `ASSIGNED_BRANCHES`.
13. Staff have explicit branch assignments (`staff_branch_assignments`). In
    `ASSIGNED_BRANCHES` mode the API restricts every staff query to assigned branches;
    Hospital Admin and Hospital Management remain tenant-wide.
14. Branch scoping is enforced in API authorization (not RLS) so the mode can change without
    a migration; RLS continues to enforce the hospital boundary underneath.

### Residency (D4)

15. One production deployment hosted in India. Every tenant row records `data_region`
    (initially always `IN`) so a future regional deployment (e.g. EU) can host tenants
    from that region without schema changes. There is no cross-region data movement.

### Verification

16. Automated tests prove isolation: tenant A can never read or write tenant B's rows,
    including through direct SQL as `kenisha_app`; `kenisha_platform` cannot select from any
    clinical table; branch mode restricts staff as configured.

## Consequences

- Prisma does not manage RLS or role grants; they are written as SQL inside migrations and reviewed.
- All data access goes through a tenant-aware Prisma wrapper; raw clients are not injected
  into feature modules.
- A patient visiting two hospitals has two logins and two records (D1). Sharing records between
  hospitals is out of scope; if needed later (e.g. ABDM/ABHA integration) it requires a new ADR
  with an explicit consent model.
- Login UX needs a hospital identifier (subdomain or code) — included in Milestone 3.
- Platform support cannot see patient data without a hospital-approved grant (D2). Support
  processes must be designed around this.
- A tenant that later needs physical isolation (e.g. contractual) can be moved to a dedicated
  database instance running the same schema.

## Approval

- [x] Approved by product owner — 2026-10-30
