# Runbook: secret inventory and rotation

Every secret the platform uses, who holds it, and how to replace it without an outage.
Rotate **immediately** if a secret may have leaked (then also follow
[incident-response.md](incident-response.md)), and otherwise on the schedule below.

Never paste a secret into a ticket, chat, commit or log. Generate new values on a trusted
machine with `pnpm --filter @kenisha/api auth:secrets` (prints all four API secrets; use only
the lines you need).

## Inventory

| Secret                                       | Where it lives                     | Schedule        | Impact of rotation                            |
| -------------------------------------------- | ---------------------------------- | --------------- | --------------------------------------------- |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`         | API environment                    | Yearly          | None if the procedure below is followed       |
| `PLATFORM_TOTP_KEY`                          | API environment                    | Yearly          | None if the procedure below is followed       |
| `OTP_HMAC_SECRET`                            | API environment                    | Yearly          | Codes sent in the last 5 minutes stop working |
| `kenisha_app` / `kenisha_platform` passwords | API environment (`*_DATABASE_URL`) | Yearly          | Brief reconnect                               |
| `kenisha_migrator` password                  | Deployment pipeline only           | Yearly          | None                                          |
| PostgreSQL superuser password                | Server operator only               | Yearly          | None                                          |
| `REDIS_PASSWORD`                             | Server environment                 | Yearly          | Brief reconnect                               |
| SMS provider API key                         | API environment (provider TBD)     | Per provider    | None if both keys are valid during the switch |
| Backup encryption key                        | Milestone 5b                       | Milestone 5b    | Milestone 5b                                  |
| Super Admin passwords and authenticators     | Each Super Admin                   | On staff change | Operator re-creates the account               |

`SEED_STAFF_PASSWORD` and the CI database passwords are not production secrets: they exist
only on developer machines and in throwaway CI containers.

## JWT signing key (no one is signed out)

Access tokens live 15 minutes and carry the ID of the key that signed them (`kid`).

1. Generate a new key pair (`auth:secrets`, the two `JWT_*` lines).
2. Deploy with the **new** `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY`, and the **old** public key
   in `JWT_PREVIOUS_PUBLIC_KEY`. The API refuses to start if the new public key does not
   belong to the new private key. New tokens are signed with the new key; tokens signed
   earlier keep working until they expire.
3. Wait at least `ACCESS_TOKEN_TTL_SECONDS` (default 15 minutes) plus clock skew; 30 minutes
   is safe.
4. Remove `JWT_PREVIOUS_PUBLIC_KEY` and redeploy. Tokens signed with the old key are now
   rejected (`unknown key`).
5. Destroy every copy of the old private key.

**If the private key leaked:** skip step 3 — deploy without `JWT_PREVIOUS_PUBLIC_KEY` at once.
Every access token becomes invalid; clients renew through their refresh tokens (database
records, not signed with this key), so users stay signed in.

## `PLATFORM_TOTP_KEY` (no authenticator has to be re-enrolled)

This key encrypts every Super Admin authenticator secret. Each encrypted secret records the
ID of the key that sealed it.

1. Generate a new 32-byte key (`auth:secrets`, the `PLATFORM_TOTP_KEY` line).
2. Deploy with the new key in `PLATFORM_TOTP_KEY` and the old one in
   `PLATFORM_TOTP_KEY_PREVIOUS`. Every successful Super Admin login re-encrypts that
   account's secret under the new key.
3. Re-encrypt all remaining accounts at once, from a trusted machine with the same three
   variables set: `pnpm --filter @kenisha/api platform:reseal-totp`. It prints counts only
   and fails if any secret cannot be read — then keep the previous key and investigate.
4. Remove `PLATFORM_TOTP_KEY_PREVIOUS` and redeploy. Destroy every copy of the old key.

**If the key leaked together with the database:** the authenticator secrets must be treated
as known. Rotate as above, then re-create every Super Admin account
(`platform:create-admin`) so each enrols a fresh authenticator.

## `OTP_HMAC_SECRET`

Deploy the new value. One-time codes issued in the previous 5 minutes fail; users request a
new one. No other effect.

## Database role passwords

1. `ALTER ROLE kenisha_app PASSWORD '<new>'` (as the superuser or migrator owner of roles).
2. Update `DATABASE_URL` (or `PLATFORM_DATABASE_URL`) and restart the API.
3. Check `GET /api/v1/health/ready` returns 200 for both connections.

Existing connections keep working until they close, so the order of steps 1 and 2 only
affects new connections; do both within a few minutes.

## After every rotation

- Record the date, the secret name (never the value) and who rotated it in the operations log.
- Confirm readiness is 200 and a staff and a Super Admin login work.
