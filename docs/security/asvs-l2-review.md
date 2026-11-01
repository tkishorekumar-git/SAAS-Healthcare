# Internal OWASP ASVS Level 2 review

- **Date:** 2026-11-01 (Milestone 5a, [ADR-0005](../architecture/adr/0005-security-review-gate.md) S3)
- **Standard:** OWASP Application Security Verification Standard 4.0.3, Level 2
- **Scope:** API, web consoles and database as built in Milestones 1–4; the VPS and proxy are
  reviewed in 5b; the Android app when its login is built
- **Depth:** chapter by chapter, against the requirements that apply to the current code.
  A requirement-by-requirement sheet is prepared for the independent penetration test before
  the first real hospital (S3) — that test is the external check of this review.

Result: **Pass** = met with evidence · **Partial** = met except the noted gap ·
**Gate** = not applicable yet, owned by a later milestone · **N/A** = feature does not exist

| Chapter                            | Result  | Evidence and notes                                                                                                                                                                                                                                   |
| ---------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 Architecture & threat modelling | Pass    | ADRs 0001–0005; STRIDE [threat model](threat-model.md); least-privilege database roles; one API as the only data path (CLAUDE.md rule 5)                                                                                                             |
| V2 Authentication                  | Partial | Argon2id, 12–128 chars, breached-password list, lockout, generic errors, SMS second factor (staff), TOTP (Super Admin), new-device alerts. **Gaps:** bundled breached list is short until refreshed; SMS is a weaker factor (ADR-0003 accepted risk) |
| V3 Session management              | Pass    | 15-minute Ed25519 tokens; rotating refresh tokens with replay detection; idle and absolute timeouts; server-side revocation checked on every request; HttpOnly, Secure, SameSite=Strict cookies; sign-out revokes server-side                        |
| V4 Access control                  | Pass    | Deny by default; the API refuses to start with a route lacking an access decision; route inventory pinned in tests; cross-tenant attacks on every ID route return 404; patient tokens refused on every staff route; RLS as the backstop              |
| V5 Validation, sanitisation        | Pass    | Global DTO validation with allow-listing; zod for configuration; parameterised queries only (Prisma, tagged `$queryRaw`); no HTML rendering of user input outside React escaping                                                                     |
| V6 Stored cryptography             | Partial | Node `crypto` only (no custom primitives); AES-256-GCM with random IVs; SHA-256 for random tokens; HMAC for codes; key IDs and rotation procedures. **Gate:** field-level encryption of national IDs (Milestone 6), disk and backup encryption (5b)  |
| V7 Error handling & logging        | Pass    | Fixed error bodies; unexpected errors logged as class + code + error ID; PHI canary test over every log level; audit log append-only and in the same transaction as changes                                                                          |
| V8 Data protection                 | Partial | No tokens in browser storage; no PHI in URLs; data minimisation purge; `no-referrer` on the invitation page. **Gate:** cache-control review of clinical responses (Milestone 6); retention periods (legal counsel)                                   |
| V9 Communication                   | Pass    | TLS 1.2/1.3 only and HSTS at Caddy (5b); internal traffic on a private Docker network; to be confirmed by an SSL Labs check at the first server build                                                                                                |
| V10 Malicious code                 | Pass    | Lockfile; Dependabot; OSV-Scanner, Semgrep and gitleaks in CI; no dynamic code execution                                                                                                                                                             |
| V11 Business logic                 | Pass    | Plan limits under row locks; invitation and break-glass lifecycles enforced by database triggers; per-number SMS limits; optimistic lock on TOTP steps                                                                                               |
| V12 Files & resources              | N/A     | No file upload or download yet. **Gate:** Milestone 6+ (documents, images) must add size/type checks, storage outside the web root and malware scanning                                                                                              |
| V13 API & web services             | Pass    | Versioned REST, strict JSON parsing with size limits, CORS allow-list, Swagger off in production and blocked at the proxy, rate limits shared through Redis (5b)                                                                                     |
| V14 Configuration                  | Pass    | Environment validated at start-up without echoing values; Helmet + nonce CSP; non-root read-only containers; images scanned and pinned by digest; secrets only in root-only server files (5b)                                                        |

## Findings fixed during this review

| Finding                                                                                         | Fix                                                                            |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Unexpected errors were logged with their message, which can quote data (e.g. a duplicate phone) | Global `SafeExceptionFilter`; SMS failures logged as error class only          |
| Malformed JSON and unknown paths were echoed back in 400/404 responses                          | Own JSON parser error handling; generic 404                                    |
| A route without `@RequirePermissions` was callable by any signed-in user, including patients    | Start-up check and `@SelfService` marker; route inventory test                 |
| The invitation token stayed in the address bar and browser history                              | Read once, removed with `history.replaceState`; `Referrer-Policy: no-referrer` |
| No way to rotate the JWT or TOTP encryption keys without signing everyone out / re-enrolling    | Key IDs, previous-key variables, `platform:reseal-totp`, rotation runbook      |
| Expired codes, sessions and invitations were kept forever                                       | Hourly purge restricted by database policies                                   |

## Open items

Tracked in the [threat model](threat-model.md#6-open-items-and-gates).
