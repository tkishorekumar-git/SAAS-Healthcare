# Security baseline

Kenisha handles personal health information (PHI). This baseline applies from day one;
the pre-clinical checklist must be signed off before any clinical module is built.

## Regulatory context (to confirm with legal counsel)

- **India:** Digital Personal Data Protection Act 2023 (and its Rules), ABDM / NDHM health data
  guidelines where integration applies, Clinical Establishments rules for record retention.
- **International:** GDPR (EU/UK), HIPAA (US) where those markets are entered.

## Already in place (Milestone 1)

- Strict TypeScript; ESLint bans `any` and `console` (log leakage).
- API: Helmet security headers, CORS allow-list, global DTO validation with
  `whitelist` + `forbidNonWhitelisted`, global rate limiting, URI versioning.
- API: fail-fast env validation that never echoes secret values.
- Web: security headers, `poweredByHeader` off, server-only env module (`server-only`
  import prevents bundling into client code), `noindex`.
- Local infrastructure binds to `127.0.0.1` only and requires passwords.
- `.gitignore` excludes env files, keys, keystores and DB dumps.
- CI with least-privilege `permissions: contents: read`; Dependabot updates.

## Already in place (Milestone 2)

- Three least-privilege database roles; none is superuser or has `BYPASSRLS`.
- RLS **enabled and forced** on every table; fail-closed tenant context (`current_tenant_id()`
  returns NULL when unset, and errors on malformed values).
- Column-level grants: the API role cannot change `tenant_id`, tenant status or region.
- No `DELETE` grants for the API role on tenancy tables.
- Super Admin role has no privileges on tenant-owned tables (enforced by PostgreSQL, ADR-0002 D2).
- API readiness fails if it is connected as a role that could bypass RLS.
- Database errors and readiness responses never include connection strings.
- Isolation integration tests run in CI against PostgreSQL 18 (mutation-checked: weakening
  the branch policy fails 7 tests).

## Already in place (Milestone 3a)

- Deny-by-default authentication on every endpoint; permissions from one role map.
- Ed25519 JWTs verified with an allow-list of one algorithm (`alg: none` and algorithm
  confusion rejected — unit-tested); 15-minute lifetime; no names or PHI in claims.
- Refresh tokens: 256-bit, stored as SHA-256 only, rotated on use, replay revokes the session;
  web cookie is HttpOnly, Secure, SameSite=Strict and path-scoped.
- Every request re-checks the session row, so logout, theft detection and disabling a user
  take effect immediately.
- One-time codes: CSPRNG, HMAC-only storage bound to the challenge, 5-minute expiry,
  5 attempts, single use, per-number cooldown and window limits stored in PostgreSQL.
- Staff passwords: Argon2id (OWASP parameters), length and common-password policy,
  constant-work verification for unknown accounts, progressive lockout.
- Login responses never reveal whether a hospital, account or phone number exists.
- Append-only audit log enforced by grants; audit rows never hold codes, tokens or passwords
  (asserted in tests).
- Development SMS provider refuses to start outside development/test.

**Known limitations (3a):** per-IP login limits are in-process until Redis is added; the
common-password list is short (breached-password service planned); SMS as a staff factor
carries SIM-swap risk (ADR-0003 §3).

## Already in place (Milestone 3b)

- Super Admin: password + authenticator app (TOTP); secrets encrypted at rest (AES-256-GCM);
  each code accepted once; shared lockout; accounts created only by an operator script.
- Platform and hospital tokens are mutually unusable (separate audiences, separate guards,
  separate database roles).
- Break-glass is enforced in PostgreSQL: the platform cannot approve itself, approvals cannot
  exceed the requested duration, revocation is final and immediate.
- Break-glass access is read-only, re-checked on every request, and every request is logged
  in the hospital's own audit log.
- Database connections force `TimeZone=UTC` (a non-UTC server previously shifted stored
  timestamps); hand-written migrations run in a single transaction.

**Known limitations (3b):** `PLATFORM_TOTP_KEY` has no rotation procedure yet (the `v1.`
prefix allows adding one); no self-service authenticator reset (operator re-creates the
account); no new-device login alerts yet (carried over from 3a).

## Already in place (Milestone 4a)

- Staff accounts are created only through single-use, 72-hour SMS invitations; only token
  hashes are stored; admins never know passwords.
- The Super Admin's only access to a hospital table is creating first-admin invitations
  (enforced by row policies); hospitals cannot forge platform invitations.
- Plan limits are enforced under a row lock; usage is exposed to the platform as counts only.
- Role changes, disabling a user and suspending a hospital end the affected sessions at once.
- Every administrative change is written to the hospital or platform audit log.

## Already in place (Milestone 4b)

- Web consoles never store tokens in localStorage, sessionStorage or non-HttpOnly cookies;
  the access token lives in memory and is lost on reload by design.
- Refreshes are serialised (per tab and across tabs) so refresh-token rotation cannot be
  mistaken for theft; sign-out revokes the session server-side and clears the cookie.
- Passwords are cleared from page state after every sign-in attempt.
- UI permission checks are cosmetic only; the API enforces every permission.

## Already in place (Milestone 5a)

Security review documents: [threat model](security/threat-model.md),
[ASVS Level 2 review](security/asvs-l2-review.md), [scanning](security/scanning.md), and
runbooks for [secret rotation](security/runbooks/secret-rotation.md),
[incidents](security/runbooks/incident-response.md) and
[data retention](security/runbooks/data-retention.md).

- Every route must carry an access decision (`@Public`, `@PlatformRoute`,
  `@RequirePermissions` or `@SelfService`); the API refuses to start otherwise, and the full
  route inventory is pinned in a test.
- Cross-tenant attacks on every ID-bearing hospital route fail with 404 and change nothing;
  patient tokens are refused on every staff route.
- A global error filter returns fixed bodies; unexpected errors are logged as class, code and
  error ID only; malformed JSON and unknown paths are never echoed.
- Planted synthetic names and phone numbers are searched for in every log line (all levels)
  during the API test suite.
- Breached-password list bundled with the API; SMS alert when a staff account signs in
  from a new device without the SMS factor.
- JWT and `PLATFORM_TOTP_KEY` rotation without signing anyone out or re-enrolling
  authenticators.
- Expired codes, sessions, invitations and devices are purged hourly; database policies
  limit the purge to rows already past retention.
- CI scans the whole git history for secrets (gitleaks), dependencies for known
  vulnerabilities (OSV-Scanner) and code for insecure patterns (Semgrep).
- The invitation token is removed from the address bar after it is read.

**Known limitations (5a):** the bundled breached-password list is still the short starter
list until refreshed with `passwords:update`; per-IP rate limits are per process until Redis
(5b); Super Admin new-device alerts need an email provider; the ASVS review is chapter-level
(requirement-level before the independent pen test).

## Already in place (Milestone 5b)

Server build and backups: [deployment.md](deployment.md),
[server-build.md](security/runbooks/server-build.md),
[backup-restore.md](security/runbooks/backup-restore.md).

- Caddy terminates TLS 1.2/1.3 with automatic certificates and HSTS; proxy logs drop query
  strings and headers.
- Nonce-based Content-Security-Policy on every page (no inline scripts, no framing).
- Rate limits shared through Redis; the API trusts exactly one proxy hop behind Caddy.
- Containers run non-root, read-only, without capabilities; PostgreSQL and Redis are on an
  internal network; data lives on a LUKS-encrypted volume.
- Images are scanned with Trivy and every release is pinned by image digest; deployments
  need approval in GitHub and the server accepts only a commit SHA.
- Continuous encrypted backups (pgBackRest), pulled read-only by a separate backup VPS
  with hourly/daily/monthly snapshots, and a monthly automated restore test.
- The development SMS stub can never run in the production deployment.

**Known limitations (5b):** nothing has run on a real server yet — TLS grade, the encrypted
volume and the first restore test are proved during the first server build; no upstream
DDoS protection; both VPSes are at one provider (ADR-0006 accepted risk).

## Pre-clinical security review checklist (Milestone 5 gate)

Evidence for each item is in the [threat model](security/threat-model.md) and the
[ASVS review](security/asvs-l2-review.md). Items marked _5b_ close with the production
deployment; items marked _M6_ are design requirements for the first clinical milestone.

- [x] Threat model (STRIDE) for API, web, mobile, infrastructure —
      [threat-model.md](security/threat-model.md) (mobile and VPS sections carry gates)
- [x] Tenant isolation tests: cross-tenant read/write attempts fail at app **and** RLS layers
      — `apps/api/test/isolation.e2e-db-spec.ts` + database isolation suites; new tables
      must be added to both
- [x] AuthN: password policy, MFA for staff/admins, secure session/token lifetimes, revocation
- [x] AuthZ: every endpoint has role + resource checks; deny by default — start-up check and
      route inventory
- [ ] Audit log for all access to and changes of clinical records — _M6_ (administrative and
      sign-in events are audited today)
- [x] No PHI in logs, URLs, error responses — canary test and error filter (analytics and
      crash reporting do not exist yet; any future one needs a PHI review)
- [x] Encryption in transit (TLS 1.2+, HSTS) and at rest (disk + backups) — built in 5b;
      proved at the first server build (SSL Labs grade, LUKS volume)
- [x] Field-level encryption decision for highly sensitive fields — ADR-0005 S2 (implemented
      in _M6_)
- [x] Backups encrypted, off-site, restore tested — pgBackRest + backup VPS + monthly
      `restore-test.sh`; first `PASS` recorded at the first server build
- [x] Secrets rotation procedure documented —
      [secret-rotation.md](security/runbooks/secret-rotation.md); root-only secret files on the
      server, never in images or git
- [x] Dependency and container image scanning in CI — OSV-Scanner and Trivy
- [x] Secret scanning (gitleaks) in CI; optional pre-commit hook documented
- [ ] Mobile: secure storage for tokens, no secrets in APK, release builds HTTPS-only — no
      secrets today; the rest is a gate on the Android login milestone
- [x] Data retention and deletion procedures —
      [data-retention.md](security/runbooks/data-retention.md); clinical periods need legal
      counsel before _M6_
- [x] Incident response and breach-notification runbook —
      [incident-response.md](security/runbooks/incident-response.md) (legal review before go-live)

## Reporting

Report suspected vulnerabilities privately to the project owner — never in a public issue.
