# Threat model (STRIDE)

- **Status:** Milestone 5a review, 2026-11-01 ([ADR-0005](../architecture/adr/0005-security-review-gate.md))
- **Scope:** API, web app, Android app, PostgreSQL, and the planned VPS (built in Milestone 5b)
- **Review again:** before Milestone 6 stores PHI, after any change to authentication or
  tenancy, and at least once a year

Each threat names its mitigation and the **evidence** that proves it: a test that fails if
the mitigation is removed, or a document. "Open" items carry the gate by which they must be
closed.

## 1. Assets

| Asset                                                   | Why it matters                                    |
| ------------------------------------------------------- | ------------------------------------------------- |
| Clinical records (from Milestone 6)                     | PHI; DPDP Act 2023; patient safety                |
| Identity data: names, phone numbers, emails             | Personal data; account takeover                   |
| Credentials: password hashes, refresh tokens, TOTP keys | Account takeover, including Super Admin           |
| Signing and encryption keys (`environment.md`)          | Forged tokens; decrypting every Super Admin TOTP  |
| Audit logs                                              | Accountability; breach investigation; legal proof |
| Tenant boundaries                                       | One hospital must never see another's data        |

## 2. Trust boundaries and data flows

```
 Browser (web)  ──HTTPS──┐                     ┌── kenisha_app ────────► PostgreSQL 18
 Android app    ──HTTPS──┼──► Caddy ──► API ───┤    (RLS, one tenant      (forced RLS,
 SMS provider   ◄────────┘    (TLS)    (Nest)  │     per transaction)      column grants)
                                               └── kenisha_platform ───►  (platform tables
                                                    (Super Admin)           only)
```

| Boundary                    | What crosses it                    | Controls                                                                                                                  |
| --------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Internet → API              | Every request                      | TLS (5b), rate limits, deny-by-default guard, DTO allow-listing, fixed error shapes                                       |
| API → PostgreSQL            | Queries                            | Least-privilege roles, `withTenant()` per transaction, RLS forced on every table, readiness refuses roles that bypass RLS |
| Hospital ↔ hospital         | Nothing, ever                      | Tenant ID from the token only; RLS; composite foreign keys                                                                |
| Super Admin ↔ hospital data | Counts, first-admin invitations    | Separate role with no hospital grants; break-glass grants approved by the hospital                                        |
| API → SMS provider          | Phone numbers, codes, invite links | Provider interface; development stub refused outside dev/test; provider choice before go-live (ADR-0003 I3)               |

## 3. Threats

Legend: ✅ mitigated with evidence · 🟡 partly mitigated · ⛔ open (gate named)

### Spoofing

| #   | Threat                                       | Mitigation                                                                                                       | Evidence                                                  | State |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----- |
| S1  | Forged or altered access token               | Ed25519 only; `alg` allow-list; `kid` must match a configured key; issuer, audience, expiry checked              | `ed25519-jwt.spec.ts`, `auth-guard.e2e-spec.ts`           | ✅    |
| S2  | Password guessing / credential stuffing      | Argon2id; 12+ chars; breached-password list; progressive lockout; per-IP limit; staff SMS factor                 | `password.spec.ts`, `auth.e2e-db-spec.ts` (lockout)       | 🟡    |
| S3  | Stolen refresh token reused                  | Rotation on every use; replay revokes the whole session; HttpOnly SameSite=Strict cookie                         | `auth.e2e-db-spec.ts` (replay), `session-manager.test.ts` | ✅    |
| S4  | SIM swap / SMS interception for staff factor | SMS is a second factor, not the only one; new-device alerts; Super Admin uses TOTP                               | ADR-0003 §3; `auth.e2e-db-spec.ts` (new-device alerts)    | 🟡    |
| S5  | Hospital token used on platform endpoints    | Separate audiences, guards and database roles                                                                    | `platform.e2e-db-spec.ts` ("never cross over")            | ✅    |
| S6  | Invitation link intercepted                  | 256-bit single-use token, 72 h, hash only; removed from the address bar; `no-referrer`; invitee proves the phone | `administration.e2e-db-spec.ts`, `invite-form.test.tsx`   | ✅    |
| S7  | Account enumeration on login                 | Generic messages; equal work for unknown accounts                                                                | `auth.e2e-db-spec.ts`                                     | ✅    |

S2 and S4 stay 🟡: the bundled breached-password list is short until it is refreshed
(`passwords:update`), and SMS remains a weaker factor. Per-IP limits are shared through
Redis since 5b.

### Tampering

| #   | Threat                                          | Mitigation                                                                                               | Evidence                                                               | State |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----- |
| T1  | Hospital A changes Hospital B's records via API | Tenant ID from the token; RLS; every ID-bearing route attacked in tests; route list checked for coverage | `isolation.e2e-db-spec.ts`, `tenant-isolation.int.test.ts` (+4 suites) | ✅    |
| T2  | Smuggled `tenantId` or extra fields in requests | Global `whitelist` + `forbidNonWhitelisted`                                                              | `auth-guard.e2e-spec.ts`, `isolation.e2e-db-spec.ts`                   | ✅    |
| T3  | Audit log altered or deleted                    | INSERT + SELECT grants only; no UPDATE/DELETE for any application role                                   | `identity-isolation.int.test.ts`                                       | ✅    |
| T4  | Break-glass grant widened or self-approved      | Transition trigger; maximum window; approval only by Hospital Admin                                      | `platform-isolation.int.test.ts`                                       | ✅    |
| T5  | Malicious dependency or base image              | Lockfile; Dependabot; OSV-Scanner on dependencies; Trivy on every image; releases pinned by image digest | `ci.yml` security job, `images.yml`; [scanning.md](scanning.md)        | ✅    |

### Repudiation

| #   | Threat                                  | Mitigation                                                                       | Evidence                        | State |
| --- | --------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------- | ----- |
| R1  | Admin denies changing staff or settings | Audit event in the same transaction as every administrative change               | `administration.e2e-db-spec.ts` | ✅    |
| R2  | Super Admin denies support access       | Every break-glass request logged in the hospital's own audit log                 | `platform.e2e-db-spec.ts`       | ✅    |
| R3  | Clinical record access without trace    | Not built yet: Milestone 6 must audit every read and change of a clinical record | Gate: Milestone 6 design review | ⛔    |

### Information disclosure

| #   | Threat                                    | Mitigation                                                                                                                                | Evidence                                                                                                        | State |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----- |
| I1  | Cross-tenant reads                        | RLS forced on every table; API never accepts tenant IDs; list endpoints checked for foreign IDs                                           | `isolation.e2e-db-spec.ts`, database isolation suites                                                           | ✅    |
| I2  | PHI in logs                               | IDs only by convention; errors logged as class + code; planted canary names/phones searched in every log line at every level              | `isolation.e2e-db-spec.ts` (canaries), `safe-exception.filter.spec.ts`                                          | ✅    |
| I3  | PHI in error responses                    | Global filter: fixed body for unexpected errors; no echo of malformed JSON or unknown paths                                               | `safe-exception.filter.spec.ts`, `auth-guard.e2e-spec.ts`                                                       | ✅    |
| I4  | PHI in URLs                               | IDs in paths only; the invitation token is removed from the URL after reading                                                             | Route inventory; `invite-form.test.tsx`                                                                         | ✅    |
| I5  | Super Admin reads hospital data           | No grants on hospital tables; break-glass is read-only, time-boxed, hospital-approved                                                     | `platform-isolation.int.test.ts`                                                                                | ✅    |
| I6  | Database dump or backup leaked            | LUKS-encrypted data volume; backups encrypted (AES-256) before writing; field-level encryption of national IDs (Milestone 6, ADR-0005 S2) | [server-build.md](runbooks/server-build.md), [backup-restore.md](runbooks/backup-restore.md); gate: Milestone 6 | 🟡    |
| I7  | Tokens stolen by XSS in the web app       | Access token in memory only; refresh token HttpOnly; React escaping; nonce-based CSP without `'unsafe-inline'` scripts                    | `session-manager.test.ts`, `csp.test.ts`; browser check on the production build                                 | ✅    |
| I8  | Secrets committed to git                  | `.gitignore`; gitleaks over full history in CI                                                                                            | `ci.yml` security job                                                                                           | ✅    |
| I9  | Expired auth data kept longer than needed | Hourly purge; database policies restrict it to rows past retention                                                                        | `security-review.int.test.ts`                                                                                   | ✅    |

I6 stays 🟡 until field-level encryption ships with Milestone 6 and the server build has
proved the encrypted volume and backups.

### Denial of service

| #   | Threat                                 | Mitigation                                                                          | Evidence                                                                              | State |
| --- | -------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----- |
| D1  | Request floods                         | Rate limits shared through Redis; 100 kB JSON / 1 MB request limits; Caddy in front | `redis-throttler.storage.spec.ts`, `redis-throttle.e2e-db-spec.ts` (real Redis in CI) | 🟡    |
| D2  | Expensive password hashing as a weapon | Password length cap (128); login rate limits                                        | `password.spec.ts`                                                                    | ✅    |
| D3  | SMS cost abuse (codes, alerts)         | Per-number cooldown and window limits; alerts only without an SMS factor            | `auth.e2e-db-spec.ts`                                                                 | ✅    |

D1 stays 🟡: there is no upstream DDoS protection; a single VPS can be overwhelmed. Revisit
before the first real hospital (provider-level protection or a CDN in India).

### Elevation of privilege

| #   | Threat                                       | Mitigation                                                                                                       | Evidence                                                 | State |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----- |
| E1  | Endpoint shipped without an access decision  | The API refuses to start if any route lacks `@Public`, `@PlatformRoute`, `@RequirePermissions` or `@SelfService` | `route-access.spec.ts`, `route-inventory.e2e-spec.ts`    | ✅    |
| E2  | Patient token calls staff endpoints          | Permission map per role; self-service routes act on the caller only                                              | `isolation.e2e-db-spec.ts` (every staff route → 403)     | ✅    |
| E3  | Staff assigns themself more roles            | Admin-only permission; nobody can change their own account; last-admin rule as defence in depth                  | `administration.e2e-db-spec.ts`                          | ✅    |
| E4  | API connects with a role that can bypass RLS | Readiness check fails; roles created without `BYPASSRLS`                                                         | `health.service.spec.ts`, `tenant-isolation.int.test.ts` | ✅    |
| E5  | Assigning another hospital's branch          | Composite foreign keys `(tenant_id, id)`                                                                         | `isolation.e2e-db-spec.ts`                               | ✅    |

## 4. Infrastructure (Milestone 5b)

| #   | Threat                                           | Mitigation                                                                                                  | Evidence                                                           | State |
| --- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----- |
| N1  | Traffic intercepted                              | TLS 1.2/1.3 only, HSTS, HTTP redirected; Caddy-managed certificates                                         | `Caddyfile`; SSL Labs check in server build                        | 🟡    |
| N2  | Database or Redis reached from outside           | Internal Docker network with no published ports; firewall 22/80/443                                         | `compose.yml`, `images.yml` validation                             | ✅    |
| N3  | Server takeover via SSH                          | Keys only, no root login, fail2ban, unattended security updates                                             | [server-build.md](runbooks/server-build.md)                        | 🟡    |
| N4  | Container escape / tampering                     | Non-root users, read-only file systems, no capabilities, `no-new-privileges`                                | `Dockerfile`, `compose.yml`                                        | ✅    |
| N5  | Malicious or wrong deployment                    | Manual workflow with required approval; forced SSH command accepts only a commit SHA; digest-pinned release | `deploy.yml`, `deploy.sh`                                          | ✅    |
| N6  | Backups deleted by an attacker on the app server | Backup VPS pulls with a read-only key; hard-link snapshots; shrink alert                                    | `backup-pull.sh`                                                   | ✅    |
| N7  | Backups unusable when needed                     | Monthly automated restore test with recorded result; DR rehearsal before go-live                            | `restore-test.sh`, [backup-restore.md](runbooks/backup-restore.md) | 🟡    |
| N8  | Tokens or PHI in proxy logs                      | Caddy logs drop query strings and all headers                                                               | `Caddyfile`                                                        | ✅    |
| N9  | Client address spoofing                          | API trusts exactly one proxy hop, only when deployed behind Caddy                                           | `env.validation.spec.ts`                                           | ✅    |

N1, N3 and N7 become ✅ once the first server build records them (SSL Labs grade, SSH
settings, first restore test `PASS`).

## 5. Mobile (Android)

The Flutter app is still a skeleton without login. Checked now: no secrets or API keys in
the code; configuration only through public `--dart-define` values. **Gate (Android login
milestone):** tokens in Android Keystore-backed secure storage, release builds HTTPS-only
(no cleartext traffic), certificate checks not disabled, no PHI in crash reports.

## 6. Open items and gates

| Item                                                                      | Gate                              |
| ------------------------------------------------------------------------- | --------------------------------- |
| First server build: TLS rating, encrypted volume, first restore test PASS | First staging server build        |
| Upstream DDoS protection                                                  | Before the first real hospital    |
| Backup copy at a second provider, or written acceptance (ADR-0006 P2)     | Before the first real hospital    |
| Disaster-recovery rehearsal                                               | Before the first real hospital    |
| Audit every clinical-record read/change; field-level encryption           | Milestone 6                       |
| Refresh the breached-password list (`passwords:update`)                   | Before the first real hospital    |
| SMS provider selection and DLT templates                                  | Before the first real hospital    |
| Independent penetration test (ADR-0005 S3)                                | Before the first real hospital    |
| Super Admin new-device alerts (needs an email provider)                   | Before the first real hospital    |
| Legal confirmation of retention periods                                   | Before Milestone 6 stores records |
