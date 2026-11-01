# ADR-0005: Security review gate before clinical work

- **Status:** Accepted — decisions S1–S4 by product owner 2026-11-01; 5a approved 2026-11-01. Delivered in two parts:
  **5a** code and process review (section 1) and **5b** production deployment (section 2)
- **Date:** 2026-11-01
- **Builds on:** [ADR-0002](0002-tenant-isolation.md), [ADR-0003](0003-identity-and-access.md),
  [ADR-0004](0004-tenant-administration.md), and the pre-clinical checklist in
  [security.md](../../security.md)

## Purpose

Milestone 6 (patient registry) is the first time the platform stores PHI. Project rule 14
requires a security review first. This milestone turns the checklist in `security.md` into
evidence: each item is either **proved by an automated check in CI**, **documented as a
procedure**, or **explicitly deferred with a named gate** (for example "before the first real
hospital goes live"). Nothing on the checklist is ticked on the strength of a statement alone.

## Product decisions (2026-11-01)

| #   | Question                                  | Decision                                                                                              |
| --- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| S1  | Infrastructure items (TLS, backups, disk) | **Split:** 5a code and process review; 5b production deployment, so backups and TLS are really tested |
| S2  | Field-level encryption                    | **Selective:** app-layer encryption only for national IDs and specially protected fields              |
| S3  | Penetration testing                       | **Internal OWASP ASVS Level 2 review now; independent pen test before the first real hospital**       |
| S4  | Breached-password check                   | **Offline list bundled with the API** (no password data, even partial hashes, leaves the server)      |

## 1. Milestone 5a — code and process review

### Threat model

A STRIDE threat model in `docs/security/threat-model.md` covering the API, web, Android,
database and the (planned) VPS: assets, trust boundaries, data flows, and one row per threat
with its mitigation and the test or document that proves it. Unmitigated threats become
tracked items with a gate.

### Authorization, proved by inventory

- A test enumerates **every registered API route** at start-up and fails if any route is
  neither `@Public` (from a reviewed allow-list) nor protected by `@RequirePermissions` or
  `@PlatformRoute`. A new endpoint cannot ship without a decision.
- **Cross-tenant tests at the API layer** for every hospital endpoint: a Hospital A token
  against Hospital B's IDs returns 404, never data, for reads and writes. (RLS-layer tests
  already exist; this adds the application layer, as the checklist requires.)
- Branch-scope and role tests for every endpoint that takes a branch or staff ID.

### No PHI in logs, URLs or errors

- A global exception filter that returns a fixed error shape, never a stack trace,
  database message or echo of input.
- **Canary test:** e2e runs seed distinctive synthetic names and phone numbers, capture
  every log line and response, and fail if a canary appears where it should not (logs,
  error bodies, URLs, `Location` headers).
- Review of every `Logger` call and of the access-log format (IDs only).

### Authentication follow-ups carried from Milestone 3

- Breached-password check (S4).
- New-device sign-in alert by SMS for staff and Super Admins.
- `PLATFORM_TOTP_KEY` and JWT signing-key rotation procedures, with a test that a rotated
  key still decrypts/verifies old material during the overlap window.
- Clean-up of expired one-time codes, sessions and invitations (data minimisation).

### Supply chain and secrets in CI

- **gitleaks** in CI over the full history, plus an optional pre-commit hook.
- **OSV-Scanner** for npm and pub dependencies; the build fails on known high/critical
  vulnerabilities without a recorded exception.
- **Semgrep** (open-source rules for TypeScript/Node/React) as static analysis.
  CodeQL needs paid GitHub Advanced Security on a private repository, so it is not proposed.

### Procedures (documents, reviewed)

- Secret inventory and rotation runbook (every variable in `environment.md`).
- Incident response and breach-notification runbook (DPDP Act 2023: notify the Data
  Protection Board and affected people; who decides, who acts, templates).
- Data-retention and erasure procedure: what is deleted, when, and what must be kept by law.
  Clinical retention periods **need confirmation from legal counsel** before Milestone 6
  stores records; until then nothing clinical is ever deleted automatically.
- Internal **OWASP ASVS Level 2** review (S3): chapter by chapter in 5a; a
  requirement-by-requirement sheet is prepared for the independent pen test.

### Field-level encryption (S2)

Disk and backup encryption protect against stolen disks and backups; RLS protects against
cross-tenant access. Neither protects against a leaked database dump or an over-broad query.
The recommendation is app-layer AES-256-GCM (the same scheme as the TOTP secrets) for a
**small, named list**: national identifiers (Aadhaar, ABHA number) and fields a module later
marks as specially protected. Encrypted fields cannot be searched or sorted, so encrypting
all PHI would break patient search; lookups on national IDs use a keyed hash instead.
Milestone 6 implements it; 5a records the decision and the key-management design.

## 2. Milestone 5b — production deployment (S1)

- Production Dockerfiles (non-root, read-only filesystem, pinned digests) and **Trivy**
  image scanning in CI.
- Caddy with automatic TLS, TLS 1.2+ only, HSTS; PostgreSQL and Redis never exposed publicly.
- Redis-backed rate limiting (in-process limits do not hold across instances or restarts).
- Encrypted disk and **encrypted, off-site, automated backups** (PostgreSQL base backup +
  WAL) with a **restore test** that runs on a schedule and is recorded.
- Secrets supplied to containers from a root-only file on the VPS, never baked into images.
- Monitoring and alerting without PHI.

5b needs a Hostinger VPS, a domain and an off-site storage bucket. Choosing those providers
is a separate decision that will be asked for when 5b starts.

## 3. Exit criteria (the gate)

Milestone 6 starts only when:

1. every checklist item in `security.md` is ticked with a link to its evidence, or deferred
   with a named gate the product owner has accepted;
2. all new CI checks pass on `main`;
3. no open high or critical finding remains;
4. the product owner signs off this ADR as Accepted.

## Implementation notes (Milestone 5a, 2026-11-01)

- **Route access:** new `@SelfService()` marker for routes any signed-in hospital user may
  call on their own account (`/auth/me`, `/auth/logout`, `/auth/logout-all`).
  `RouteAccessCheck` stops the API at start-up if a route has no decision or a
  contradictory one; `test/route-inventory.e2e-spec.ts` pins every route's decision.
- **Errors:** `SafeExceptionFilter` plus an own JSON body parser error handler (Node's
  parse errors quote the request body).
- **Isolation and PHI:** `test/isolation.e2e-db-spec.ts` attacks every ID-bearing hospital
  route from another hospital (and fails if a new one is not covered), sends a patient
  token to every staff route, and records every log call at every level to search for
  planted canary names and phone numbers. Mutation-checked: a logged phone number, a
  permissive permission guard and a disabled alert each fail it.
- **New-device alerts:** `known_devices` (hash of a 256-bit device token; web cookie
  `kenisha_dev`, mobile body field). Alerts only for staff sign-ins without the SMS factor,
  and not for a user's first device. Super Admins have no phone number on record, so their
  alerts wait for an email provider.
- **Key rotation:** JWTs carry `kid`; `JWT_PREVIOUS_PUBLIC_KEY` verifies old tokens during a
  rotation; the API refuses a public key that does not match the private key. Sealed TOTP
  secrets are `v2.<key id>.…`; `PLATFORM_TOTP_KEY_PREVIOUS`, re-seal on login and
  `platform:reseal-totp`.
- **Purge:** migration `20261101120000_security_review` adds `purge_expired_auth_data()`
  (SECURITY DEFINER) and owner policies that admit only rows past retention, so even a
  faulty function cannot delete live data (mutation-checked).
- **Breached passwords (S4):** loaded from `apps/api/data/breached-passwords.txt`. By the
  product owner's choice (2026-11-01) no list was downloaded: the file holds the existing
  starter list, and `passwords:update <file>` merges a list the operator downloads.
  Refreshing it is a gate before the first real hospital.
- **Scanning:** gitleaks, OSV-Scanner and Semgrep run from pinned images in a new CI job
  (not runnable on the development machine, which has no Docker; first verified on GitHub).
- **Web:** the invitation token is removed from the URL after reading;
  `Referrer-Policy: no-referrer` on `/invite`.

## Out of scope

Mobile security beyond a review of the current Flutter skeleton (secure token storage and
HTTPS-only release builds are checked when the Android login is built), payments, and the
SMS provider choice (ADR-0003 I3).
