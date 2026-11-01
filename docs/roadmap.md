# Roadmap

Each milestone ends with a review and explicit approval before the next one starts.

| #   | Milestone                                                                                                                                                                                                     | Status           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1   | **Monorepo foundation** — apps, shared packages, tooling, Docker dev env, CI, docs                                                                                                                            | ✅ Complete      |
| 2   | **Database foundation** — Prisma, tenancy tables (tenants, branches, subscriptions), RLS, migrations, synthetic seed, readiness check                                                                         | ✅ Complete      |
| 3a  | **Identity & access (hospital users)** — hospital-first login, patient SMS-code login, staff password + SMS factor, sessions, permissions, branch scope, audit log                                            | ✅ Complete      |
| 3b  | **Identity & access (platform)** — Super Admin login with authenticator app, break-glass support access                                                                                                       | ✅ Complete      |
| 4a  | **Tenant administration (API)** — onboarding, SMS staff invitations, staff/branch management, settings, plan limits, suspension                                                                               | ✅ Complete      |
| 4b  | **Tenant administration (web)** — first admin web screens: sign-in, invitation acceptance, Hospital Admin and Super Admin consoles                                                                            | ✅ Complete      |
| 5a  | **Security review (code & process)** — threat model, route inventory, API cross-tenant tests, PHI canaries, CI scanning, runbooks ([ADR-0005](architecture/adr/0005-security-review-gate.md))                 | ✅ Complete      |
| 5b  | **Production deployment** — staging VPS, Dockerfiles, Caddy/TLS, Redis rate limits, pgBackRest to a backup VPS with restore test, image scanning ([ADR-0006](architecture/adr/0006-production-deployment.md)) | Ready for review |
| 6   | **Patient registry** — patients, guardians, consent, shared clinical foundations                                                                                                                              | Planned          |
| 7+  | Clinical modules — Hospital Management, Chronic Care, Maternal, Pediatric                                                                                                                                     | Planned          |
| —   | **Deployment** — production Dockerfiles, Caddy, Hostinger VPS, automated backups, monitoring                                                                                                                  | Now Milestone 5b |

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

## Milestone 3b deliverables

- Platform tables (Super Admin users, sessions, audit) and `support_access_requests`, with
  forced RLS, database-enforced break-glass transitions and a maximum approval window.
- Super Admin login: password + authenticator app (TOTP, RFC 6238), encrypted secrets,
  replay protection, shared lockout; operator script to create accounts.
- Break-glass: request (platform) → approve/reject/revoke (Hospital Admin) → short-lived,
  read-only, grant-checked token; every use in the hospital's audit log.
- Readiness checks both database connections and that each logs in as the right role.
- Fixed: timestamps shifted by the database server's time zone (connections now force UTC);
  migrations are now atomic.
- 11 new database tests, 14 new API end-to-end tests, RFC test vectors; mutation-checked.

## Milestone 4a deliverables

- `staff_invitations` with database-enforced lifecycle and the one narrow platform grant
  (first-admin invitations only); `tenant_usage()` (counts only); one-way hospital activation.
- Invitations: SMS link, 72-hour single-use token (hash stored), inspect/accept, resend,
  revoke; the invitee sets their own password.
- Hospital Admin: staff list, roles, branches, disable/enable, unlock; branches create/edit/
  deactivate/reactivate; settings (name, branch scope, SMS-factor mode).
- Super Admin: onboard a hospital, list/detail with usage, change plan, suspend/reactivate,
  resend first-admin invitation.
- Plan limits (branches, staff incl. pending invitations, modules) with row locking;
  `/auth/me` returns enabled modules.
- 17 new database tests, 22 new API end-to-end tests; mutation-checked.

## Milestone 4b deliverables

- Web sign-in: staff (password + SMS code), Super Admin (password + authenticator code),
  invitation acceptance (set password).
- Hospital Admin console: overview (plan, usage, modules), staff (invite, edit roles/branches,
  disable/enable, unlock), invitations (resend/cancel), branches, settings, support-access
  approvals, audit log. Navigation follows the user's permissions.
- Super Admin console: hospitals with usage counts, onboarding, hospital detail (plan change,
  suspend/reactivate, resend admin invitation), support-access requests.
- Session handling: access token in memory only; refresh via the HttpOnly cookie; one refresh
  at a time per tab and across tabs (Web Locks), so rotation never triggers theft detection.
- Shared UI components: input, select, textarea, label/field, table, alert.
- Unit/component tests (session manager, API client, sign-in and invitation forms) and a live
  browser walkthrough of onboarding → invitation → first login → branches → staff invite →
  audit log → sign-out, including phone width.

## Milestone 5a deliverables

- Security review documents: STRIDE threat model with evidence per threat, chapter-level
  ASVS Level 2 review, scanning policy, and runbooks for secret rotation, incident response
  and breach notification, and data retention.
- Every route needs an access decision or the API refuses to start; the route inventory is
  pinned in a test.
- API-layer tenant isolation: every ID-bearing hospital route attacked from another hospital;
  patient tokens refused on every staff route; PHI canaries searched in every log line.
- Global error filter (no stack traces, database messages or echoed input).
- Breached-password list loader (starter list until refreshed), new-device SMS alerts for
  staff, JWT and authenticator-key rotation without sign-outs, hourly purge of expired
  authentication data (database-enforced retention).
- CI security job: gitleaks (full history), OSV-Scanner (npm and Dart), Semgrep.
- Invitation token removed from the browser address bar.

## Milestone 5b deliverables

- Production images (API, web, migration job, PostgreSQL with pgBackRest): non-root,
  read-only, scanned with Trivy, pushed to GHCR per commit; releases pinned by digest.
- Server stack (Docker Compose) behind Caddy: TLS 1.2/1.3, HSTS, same-origin API for the web
  app, proxy logs without query strings or headers; PostgreSQL and Redis on an internal network.
- Nonce-based Content-Security-Policy; rate limits shared through Redis; trusted proxy hop
  setting; `DEPLOYMENT_ENV` keeps the SMS stub out of production.
- Deploy workflow with required approval and a forced-command SSH key; `deploy.sh` migrates,
  checks readiness and rolls back on failure.
- Continuous encrypted backups pulled by a separate backup VPS, hourly/daily/monthly
  snapshots, monthly automated restore test.
- Runbooks: server build, backup/restore and disaster recovery; threat model, ASVS review
  and security checklist updated.
