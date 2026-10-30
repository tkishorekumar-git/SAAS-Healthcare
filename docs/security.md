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

## Pre-clinical security review checklist (Milestone 5 gate)

- [ ] Threat model (STRIDE) for API, web, mobile, infrastructure
- [ ] Tenant isolation tests: cross-tenant read/write attempts fail at app **and** RLS layers
      _(RLS layer done in M2; extend to every new table and to API endpoints)_
- [ ] AuthN: password policy, MFA for staff/admins, secure session/token lifetimes, revocation
- [ ] AuthZ: every endpoint has role + resource checks; deny by default
- [ ] Audit log for all access to and changes of clinical records (who, what, when, tenant)
- [ ] No PHI in logs, URLs, error responses, analytics, crash reports
- [ ] Encryption in transit (TLS 1.2+, HSTS) and at rest (disk + backups)
- [ ] Field-level encryption decision for highly sensitive fields
- [ ] Backups encrypted, off-site, restore tested
- [ ] Secrets in a secret store; rotation procedure documented
- [ ] Dependency and container image scanning in CI
- [ ] Secret scanning (e.g. gitleaks) in CI and pre-commit
- [ ] Mobile: secure storage for tokens, no secrets in APK, release builds HTTPS-only
- [ ] Data retention and deletion procedures (DPDP rights of data principals)
- [ ] Incident response and breach-notification runbook

## Reporting

Report suspected vulnerabilities privately to the project owner — never in a public issue.
