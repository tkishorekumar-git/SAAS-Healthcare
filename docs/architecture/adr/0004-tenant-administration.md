# ADR-0004: Tenant administration — onboarding, staff, branches, plan limits

- **Status:** Accepted — approved by product owner 2026-10-30 (including the narrow platform grant)
- **Date:** 2026-10-30
- **Builds on:** [ADR-0002](0002-tenant-isolation.md) (tenant isolation, D2: no Super Admin
  access to hospital data), [ADR-0003](0003-identity-and-access.md) (identity, sessions)

## Product decisions (2026-10-30)

| #   | Question                         | Decision                                                                                |
| --- | -------------------------------- | --------------------------------------------------------------------------------------- |
| T1  | First Hospital Admin of a tenant | **One-time SMS invitation** created by the Super Admin; the admin activates it themself |
| T2  | Adding other staff               | **SMS invitation** from the Hospital Admin; staff set their own password                |
| T3  | Scope                            | **API + first admin web screens**, delivered as **4a (API)** then **4b (web)**          |
| T4  | Subscriptions                    | **Enforce plan limits** (branches, staff, modules). No payments yet                     |

## 1. Invitations (T1, T2)

One mechanism for every staff account, including a hospital's first admin.

1. An invitation records name, mobile, optional email, role(s) and branch assignments.
2. A 256-bit random token is generated; **only its SHA-256 hash is stored**. The token is
   sent by SMS as a link: `https://<app>/invite?hospital=<code>&token=<token>`.
3. The invitee opens the link, sees their name, hospital and role (phone masked), and sets
   a password (same policy as ADR-0003). The account, roles and branch assignments are
   created in one transaction; the invitation is consumed (single use).
4. Invitations expire after **72 hours**; admins can resend (new token, old one dies) or
   revoke them. Their first login then follows the normal staff flow (password + SMS code).

Admins never know anyone's password. Possession of the SMS link proves the phone number.

### How the Super Admin invites the first admin without touching hospital data

`staff_invitations` is a tenant-owned table (RLS). ADR-0002 D2 forbids the platform role
from hospital data, so the platform gets **one narrow, explicit grant**:

- `INSERT` only, only rows whose roles are exactly `{HOSPITAL_ADMIN}` and which record the
  inviting Super Admin;
- `SELECT` only on the rows it created (to show "invitation pending / accepted");
- **no access at all** to `users`, credentials, sessions, audit or any other hospital table.

The account itself is always created by the API's hospital role (`kenisha_app`) inside the
hospital's tenant context when the invitee accepts. This is the only change to D2 and is
covered by isolation tests.

## 2. Hospital administration (Hospital Admin)

| Area       | Capabilities                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------------- |
| Staff      | List, invite, resend/revoke invitation, change roles, assign branches, disable/enable, unlock     |
| Safeguards | Cannot disable or demote themself; a hospital must always keep at least one active Hospital Admin |
| Branches   | Create, edit, deactivate/reactivate (never delete)                                                |
| Settings   | Hospital name, branch scope mode (ADR-0002 D3), staff SMS-factor mode (ADR-0003 I5)               |
| Oversight  | Support-access approvals and audit log (already built in Milestone 3)                             |

Hospital Management keeps read-only access (staff list, audit log). Every change is audited.

## 3. Platform administration (Super Admin)

- **Onboard a hospital:** code (subdomain), name, plan, first admin's name and mobile →
  creates the tenant (status `ONBOARDING`), its subscription and the admin invitation. The
  tenant becomes `ACTIVE` when the first admin accepts.
- **Hospitals list/detail:** status, plan, period, and **usage counts only** (active
  branches, active staff, pending invitations) via a `SECURITY DEFINER` function that returns
  numbers — never names or contact details.
- **Change plan; suspend / reactivate a hospital.** Suspension blocks all logins at once:
  `resolve_tenant` already refuses inactive tenants, and the per-request session check will
  additionally require the tenant to be `ACTIVE`, so existing sessions end immediately.

## 4. Plan limits (T4)

The tenant's current subscription (one non-cancelled subscription at a time) defines:

| Limit              | Enforced when                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `max_branches`     | Creating or reactivating a branch (counts active branches)                                                        |
| `max_staff_users`  | Inviting or re-enabling staff (counts active staff **plus** pending invitations)                                  |
| `included_modules` | Every clinical endpoint (from Milestone 7) declares `@RequireModule(...)`; `/auth/me` returns the enabled modules |

Checks run inside the same transaction as the change, with a row lock on the tenant, so two
admins cannot both take the last slot. Subscription status `PAST_DUE` keeps the hospital
working but blocks new staff and branches; `CANCELLED` behaves like no subscription.
Downgrading below current usage is allowed but blocks further additions until usage fits.

## 5. Web application (4b)

First real screens in `apps/web`, built from `@kenisha/ui`:

- **Sign-in:** staff (hospital code + email/mobile + password → SMS code), Super Admin
  (email + password → authenticator code), invitation acceptance (set password).
- **Hospital Admin:** overview, staff (list, invite, edit, disable/unlock), invitations,
  branches, settings, support-access requests, audit log.
- **Super Admin:** hospitals (list, onboard, detail with usage, plan, suspend), support
  access requests.
- **Session handling:** access token kept in memory only; refresh through the existing
  HttpOnly cookie; the browser calls the API directly with an allow-listed origin.
- Accessibility (keyboard, labels, contrast) and mobile-width layouts from the start.

Patient-facing screens and the patient registry are **not** part of Milestone 4
(Milestone 6), and the Android app is not changed.

## 6. Data model changes (4a)

| Change                    | Notes                                                                     |
| ------------------------- | ------------------------------------------------------------------------- |
| `staff_invitations` (new) | Tenant-owned, RLS; token hash; roles; branch IDs; status; expiry; inviter |
| `tenant_usage()` (new)    | `SECURITY DEFINER`, counts only, executable by `kenisha_platform` only    |
| Session check             | Also requires tenant `ACTIVE`                                             |
| One current subscription  | Enforced in the API (row lock); documented limitation of Prisma           |

## Implementation notes (4a)

- **Lifecycle in the database:** a trigger allows only `PENDING` -> `PENDING` (resend),
  `ACCEPTED` or `REVOKED`; accepted and revoked invitations are final. Acceptance must record
  who accepted and when. Staff invitations can never carry patient or guardian roles.
- **Platform grant as built:** `INSERT` only rows with roles exactly `{HOSPITAL_ADMIN}`, a
  platform inviter, no branches and status `PENDING`; `SELECT` only platform-created rows;
  no `UPDATE`. A restrictive policy stops hospitals from forging platform invitations.
- **`resolve_tenant`** now also returns the status, so an `ONBOARDING` hospital can accept
  its first invitation; logins still require `ACTIVE`.
- **`activate_onboarding_tenant()`** (security definer) moves only the current tenant, only
  from `ONBOARDING` to `ACTIVE`; the hospital role still cannot change its own status.
- **`tenant_usage()`** (security definer, platform only) returns counts only.
- **Plan checks** lock the tenant row (`SELECT ... FOR UPDATE`) inside the same transaction.
- **Access changes are immediate:** changing roles or disabling a user revokes their sessions;
  suspending a hospital ends all its sessions through the per-request session check.
- **Known gap:** the "keep at least one active Hospital Admin" rule cannot currently be
  reached through the API (admins cannot change themselves), so it is defence in depth and
  not covered by an end-to-end test.

## Out of scope (later milestones)

Payments and invoices; patient registration and records (Milestone 6); new-device login
alerts, breached-password service and key-rotation procedures (Milestone 5 security gate);
email delivery (invitations are SMS-only for now); bulk staff import.

## Approval

- [x] Approved by product owner — 2026-10-30
- [x] Narrow platform grant on `staff_invitations` accepted (section 1)
