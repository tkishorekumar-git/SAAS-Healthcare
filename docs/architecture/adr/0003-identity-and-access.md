# ADR-0003: Identity, authentication and authorization

- **Status:** Accepted — approved by product owner 2026-10-30. Delivered in two parts:
  **3a** hospital users (sections 1–3, 5–7, 9) and **3b** Super Admin + break-glass (sections 4, 8).
- **Date:** 2026-10-30
- **Builds on:** [ADR-0002](0002-tenant-isolation.md) (tenant-scoped accounts, no Super Admin PHI access)

## Product decisions (2026-10-30)

| #   | Question                 | Decision                                                                        |
| --- | ------------------------ | ------------------------------------------------------------------------------- |
| I1  | Patient / guardian login | **Hospital code + mobile number + SMS one-time code** (no password)             |
| I2  | Staff login              | **Password + SMS one-time code** as second factor                               |
| I3  | SMS provider             | **Decide before go-live**; build a provider interface with a development stub   |
| I4  | Sessions                 | **15-minute access JWT + rotating refresh token** stored (hashed) in PostgreSQL |
| I5  | Staff SMS factor scope   | **Mandatory for admin roles; default on for other staff, hospital may relax**   |
| I6  | Super Admin factor       | **Authenticator app (TOTP)** — not SMS                                          |

## 1. Identifying the hospital before login

Accounts are per hospital (ADR-0002, D1), so every login request names the hospital:
web uses the hospital subdomain (`<code>.kenisha…`), Android asks for the hospital code once
and remembers it.

Login happens _before_ a tenant context exists, and the API role can see no tenant rows
without one. The hospital code is therefore resolved by one narrow database function,
`resolve_tenant(code)` (`SECURITY DEFINER`, owned by the schema owner), which returns only
the tenant ID and whether it is active — never other tenant data. Every later step runs
inside `withTenant()` as normal.

## 2. Patient and guardian login (I1)

1. `POST /auth/otp/request` with hospital code + mobile number (E.164).
2. The API **always** answers "if this number is registered, a code was sent" — it never
   reveals whether an account exists.
3. Codes: 6 digits, valid 5 minutes, max 5 attempts, stored only as an HMAC (server secret),
   single use. Resend allowed after 60 seconds.
4. Rate limits per phone number, per hospital and per IP address, stored in PostgreSQL
   (works across multiple API instances; no Redis dependency).
5. `POST /auth/otp/verify` issues a session (section 5).

Patient accounts are created by the hospital (registration desk) — there is no public
self-sign-up in Milestone 3.

## 3. Staff login (I2)

1. Hospital code + email or mobile + password. Passwords hashed with **Argon2id**;
   minimum 12 characters; common/breached-password list check.
2. Correct password → an SMS code is sent to the staff member's registered mobile; the
   session is issued only after it is verified.
3. **SMS second factor scope (I5):** always mandatory for Hospital Admin and Hospital
   Management. For other staff it is controlled by the tenant setting `staff_mfa_mode`:
   `ALL_STAFF` (default) or `ADMINS_ONLY`.
4. After 5 failed attempts, progressive delays and a temporary lock; admins can unlock.
5. "Remember this device" is **not** offered in Milestone 3.

**Known risk of SMS as a second factor:** SIM-swap and SMS interception. Mitigations: alerts
on login from a new device, rate limits, short sessions for staff, full audit trail. The data
model keeps factors pluggable so an authenticator app (TOTP) can be added later without
migration pain.

## 4. Super Admin

- Separate `platform_users` table and separate endpoints (`/platform/auth/...`), served
  with the `kenisha_platform` database role. A Super Admin can never log in through a
  hospital login page, and hospital users can never reach platform endpoints.
- Password + **authenticator app (TOTP)** code, mandatory (I6). No SMS for this account.

## 5. Sessions and tokens (I4)

| Item          | Design                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------- |
| Access token  | JWT, **15 minutes**, signed with **Ed25519** (private key in API env; public key verifies)                        |
| Claims        | user ID, tenant ID, roles, session ID, audience (`web` / `mobile` / `platform`). **No PHI, no names**             |
| Refresh token | 256-bit random, stored only as a SHA-256 hash in `sessions`; **rotated on every use**                             |
| Reuse         | A refresh token used twice revokes the whole session (theft detection)                                            |
| Lifetimes     | Staff: 12 h absolute, 30 min idle. Patients/guardians on Android: 30 days, sliding                                |
| Web storage   | Refresh token in `HttpOnly; Secure; SameSite=Strict` cookie scoped to `/api/v1/auth`; access token in memory only |
| Android       | Refresh token in Android Keystore via `flutter_secure_storage`                                                    |
| Logout        | Revokes the session immediately; "log out all devices" revokes all of a user's sessions                           |

Every authenticated request is checked against the session row's tenant — a token can
never be used against a different hospital.

## 6. Authorization (roles + resources)

- **Deny by default:** a global guard requires authentication; public endpoints opt out
  explicitly (`@Public()`).
- **Role permissions** defined once in `@kenisha/shared` as a role → permission map
  (e.g. `branch:read`, `staff:manage`); endpoints declare `@RequirePermission(...)`.
- **Resource checks** in services: tenant always from the session (never the request);
  branch scope per hospital setting (ADR-0002, D3) using `staff_branch_assignments`;
  guardian ↔ child links arrive with the patient registry (Milestone 6).
- Role changes take effect at the next token refresh (≤ 15 minutes) and immediately for
  revoked sessions.

## 7. Audit log

Append-only `audit_events` table (tenant-scoped, RLS). The API role may only `INSERT`
and `SELECT` — no `UPDATE`/`DELETE`, enforced by grants. Recorded: login success/failure,
code sent/failed, session revoked, password/role changes, break-glass events. Entries hold
IDs, action, outcome, time, IP and user agent — **never** codes, passwords, tokens or PHI.

## 8. Break-glass support access (ADR-0002, D2)

1. Super Admin files a support access request (platform table `support_access_requests`,
   with reason and requested duration, max 4 hours).
2. A Hospital Admin of that hospital approves or rejects it in their admin area.
3. While approved, the Super Admin can obtain a short-lived, tenant-bound session marked
   `break_glass`; every request in it is audited and visible to the hospital.
4. Access ends automatically at expiry or when the hospital revokes it.

## 9. SMS provider (I3)

An `SmsProvider` interface with:

- `DevelopmentSmsProvider` — writes codes to the API log **only** when `NODE_ENV=development`;
  refuses to start in any other environment.
- Production provider (MSG91, Twilio or other) chosen before go-live. India requires **DLT
  registration** of sender ID and message templates — start this early, it takes weeks.

## 10. Data model added in Milestone 3

| Table                                 | Owner    | Purpose                                                |
| ------------------------------------- | -------- | ------------------------------------------------------ |
| `users`                               | tenant   | Patients, guardians and staff of one hospital          |
| `user_roles`                          | tenant   | Role assignments (a user may hold several staff roles) |
| `staff_branch_assignments`            | tenant   | Branch access for `ASSIGNED_BRANCHES` mode             |
| `password_credentials`                | tenant   | Argon2id hashes (staff only), separate from `users`    |
| `otp_challenges`                      | tenant   | Hashed one-time codes, attempts, expiry                |
| `sessions`                            | tenant   | Refresh token hashes, rotation chain, revocation       |
| `audit_events`                        | tenant   | Append-only security audit trail                       |
| `platform_users`, `platform_sessions` | platform | Super Admin accounts and sessions                      |
| `support_access_requests`             | platform | Break-glass requests and approvals                     |

All tenant tables follow the ADR-0002 rules (RLS forced, column grants, isolation tests).

## New configuration

`JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` (Ed25519), `OTP_HMAC_SECRET`, `SMS_PROVIDER`, and
provider credentials. All secrets; documented in `docs/environment.md` when implemented.

## Out of scope for Milestone 3

Staff/patient management screens (Milestone 4), self-registration, social login,
authenticator-app MFA (unless chosen for Super Admin), "remember this device", ABHA login.

## Approval

- [x] Approved by product owner — 2026-10-30
- [x] Staff SMS second-factor scope confirmed (I5)
- [x] Super Admin second factor: authenticator app (I6)

## Implementation notes (3a)

- **Account kinds.** A user row is either a `STAFF` account or a `PERSONAL` account
  (patient and/or guardian — a mother can be both). Phone numbers are unique per hospital
  _per kind_, so a doctor who is also a patient there has two separate accounts. OTP login
  accepts personal accounts only; staff must use password + factor.
- **Refresh token format:** `rt1.<tenantId>.<sessionId>.<generation>.<secret>`. The tenant
  and session IDs let the API find the session inside the right RLS context; only the
  SHA-256 of the secret is stored. A token from an older generation is a replay → the
  session is revoked. Clients must not refresh concurrently (web serialises refreshes).
- **IP rate limits** use the API's in-process limiter for now; they become shared when Redis
  is introduced. Per-phone OTP limits and per-account lockouts are stored in PostgreSQL.
- **Breached-password check:** a built-in list of common passwords in 3a; an external
  breached-password service is a later enhancement.

## Implementation notes (3b)

- **Super Admin accounts** are created only by an operator script
  (`pnpm --filter @kenisha/api platform:create-admin`); there is no sign-up endpoint.
- **TOTP**: RFC 6238 (SHA-1, 30 s, 6 digits, ±1 step drift), verified against the RFC test
  vectors. Secrets are AES-256-GCM encrypted with `PLATFORM_TOTP_KEY`; the last accepted
  step is stored so a code can never be replayed. Password and code failures share one
  lockout counter.
- **Token audiences** separate every caller: `web`/`mobile` (hospital users), `support`
  (break-glass), `platform` (Super Admin), `platform-mfa` (5-minute step between password
  and code). Each verifier accepts only its own audiences.
- **Break-glass rules enforced by PostgreSQL**: the platform role can insert requests only
  in `REQUESTED` state and has no UPDATE privilege; only the hospital can decide; a trigger
  allows only REQUESTED→APPROVED/REJECTED and APPROVED→REVOKED; approval cannot exceed the
  requested duration; revoking caps the end time at `now()`.
- **Break-glass tokens** carry no roles, are limited to read-only permissions
  (`SUPPORT_ACCESS_PERMISSIONS`), work only on permission-guarded endpoints, never outlive
  the grant, and are re-checked against the grant on every request. Each request is
  written to the hospital's own audit log (`SUPPORT_ACCESS_USED`, route template only).
- **Platform sessions** rotate like hospital sessions, with an 8-hour absolute and 15-minute
  idle limit; the refresh token is only ever in an HttpOnly cookie.

- **JWTs** are signed and verified with Node's built-in Ed25519 support (no JWT library);
  the verifier accepts only `alg: EdDSA` and checks issuer, audience and expiry.
