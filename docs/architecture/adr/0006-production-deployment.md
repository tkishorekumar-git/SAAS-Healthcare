# ADR-0006: Production deployment (Milestone 5b)

- **Status:** Accepted — decisions P1–P4 by product owner 2026-11-01
- **Date:** 2026-11-01
- **Builds on:** [ADR-0001](0001-monorepo-and-tooling.md) (Docker, Hostinger VPS, Caddy),
  [ADR-0002](0002-tenant-isolation.md) D4 (India-only data residency),
  [ADR-0005](0005-security-review-gate.md) S1 (5b closes the infrastructure checklist items)

## Purpose

Run Kenisha on a real server so that the remaining pre-clinical checklist items are proved
by working infrastructure, not by documents: TLS and HSTS, a Content-Security-Policy,
encrypted off-site backups **with a tested restore**, rate limits that hold across restarts,
and scanned container images. The design in [deployment.md](../../deployment.md) is the
starting point.

## Product decisions (2026-11-01)

| #   | Question                | Decision                                                                                                        |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| P1  | Environments            | **One staging VPS now** (synthetic data only); production built from the same files before the first hospital   |
| P2  | Off-site backup storage | **A second Hostinger VPS in India**, used only for backups                                                      |
| P3  | Backup method           | **pgBackRest: continuous WAL archiving + weekly full backups** (point-in-time restore, ~5 minutes at most lost) |
| P4  | Domain                  | **Placeholder for now**; the real domain is set when the server is created                                      |

### Consequences of P2 (backup VPS)

- The backup VPS **pulls** backups: it connects to the application server with a key that
  can only read the pgBackRest repository (`rrsync -ro`), never the other way round. A
  compromised application server has no credentials to reach, change or delete the
  off-site copies, and hard-link snapshots keep older versions even if the source is wiped.
- Backups are encrypted by pgBackRest (repository encryption, AES-256) **on the application
  server**, before they are written — PostgreSQL archives every WAL segment there, so the
  passphrase must be present there. It is also kept on the backup VPS (restore tests) and
  offline. (The first draft said "never on the application server"; that is not possible
  with continuous archiving and was corrected during implementation.)
- The backup VPS accepts SSH only from the operator and has no public services.
- **Accepted risk:** both servers are at the same provider; an account-level incident at
  Hostinger could affect both. Before the first real hospital, add a periodic encrypted copy
  to a second provider in India, or accept this in writing.

## 1. Topology (one VPS per environment)

```
Internet ──► Caddy :443 (automatic TLS, HSTS, CSP, request limits)
               ├── app.<domain>  ──► web  (Next.js standalone, non-root, read-only FS)
               └── api.<domain>  ──► api  (NestJS, non-root, read-only FS)
                                       ├── postgres 18 (private network, encrypted volume)
                                       └── redis 7.4   (private network, password, no persistence of PHI)
               local pgBackRest repository (encrypted) ◄── WAL + full/diff backups
                                       ▲
               backup VPS pulls it read-only over SSH every 5 minutes, keeps snapshots
```

- Hostinger KVM VPS in an **India** data centre (ADR-0002 D4); Ubuntu LTS. Staging uses
  `staging-app.<domain>` and `staging-api.<domain>`; the domain is a variable (P4).
- Only Caddy publishes ports (80/443). PostgreSQL and Redis are never reachable from outside.
- Firewall allows 22 (SSH keys only, no root or password login), 80 and 443.
- Disk encryption: Hostinger VPS disks are not customer-encrypted, so PostgreSQL data and
  backups live on a LUKS-encrypted volume unlocked at boot by the operator, **and** backups
  are encrypted by pgBackRest before they leave the server. (To confirm on the chosen plan.)

## 2. Images and supply chain

- Multi-stage Dockerfiles for `api` and `web`: pinned base image digests, production
  dependencies only, non-root user, read-only root filesystem, health checks.
- Built in GitHub Actions, scanned with **Trivy** (fails on high/critical), signed digest
  pushed to GitHub Container Registry. The server never builds; it pulls by digest.
- Database migrations run as a one-off container with the migrator role before the new API
  starts; the API itself never holds migrator credentials.

## 3. Deployment

- A `deploy` GitHub workflow, started by hand and protected by a GitHub environment that
  needs your approval, connects over SSH with a deploy-only key and runs a fixed script:
  pull images, migrate, restart, check readiness, roll back on failure.
- Secrets live in a root-only file on the server (`/etc/kenisha/*.env`), never in images,
  the repository or GitHub except the SSH deploy key.

## 4. Hardening closed by 5b

| Checklist item                        | How                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| TLS 1.2+, HSTS                        | Caddy automatic certificates; HSTS with `includeSubDomains`; HTTP → HTTPS                                         |
| Content-Security-Policy               | Strict CSP on the web app (nonces for Next.js scripts); `frame-ancestors 'none'`                                  |
| Rate limits across instances/restarts | `@nestjs/throttler` with a Redis store (`REDIS_URL`), plus Caddy request-size limits                              |
| Container image scanning              | Trivy in CI                                                                                                       |
| Backups encrypted, off-site, restored | pgBackRest on the backup VPS (P2/P3); **monthly automated restore test** into a scratch database, result recorded |
| Secrets in a secret store             | Root-only files on the server; rotation runbook from 5a                                                           |
| Monitoring without PHI                | Container health checks, disk/backup alerts, an external uptime check of `/health`                                |

## 5. Operations documents

- Server build runbook (from a fresh VPS to running, reproducible).
- Backup and restore runbook, including a full disaster-recovery drill.
- Update the threat model (infrastructure rows) and the security checklist.

## Implementation notes (Milestone 5b, 2026-11-01)

- **Same-origin API for the web app:** Caddy serves the API under `/api` on the web app's
  own host (`staging-app.<domain>/api/...`), and on `staging-api.<domain>` for the Android
  app. Browsers make no cross-origin calls, the CSP stays `connect-src 'self'`, and one web
  image works in every environment (`NEXT_PUBLIC_API_URL` is empty in the image).
- **`DEPLOYMENT_ENV` (`local` / `staging` / `production`):** the development SMS stub is
  allowed on staging (synthetic data, login codes in the API log) and refused when
  `DEPLOYMENT_ENV=production`. `NODE_ENV=production` requires a named deployment and
  `REDIS_URL`.
- **`TRUST_PROXY_HOPS`:** behind Caddy the API trusts exactly one proxy hop, so rate limits
  and audit logs see client addresses (otherwise every request would share Caddy's IP and
  one per-IP limit). Without a proxy it stays 0, so clients cannot fake their address.
- **Rate limits:** own Redis store (`src/throttling/`), one atomic Lua script per request;
  allows requests and logs a warning if Redis is down (lockout stays in PostgreSQL).
  Unit-tested, and tested against a real Redis in CI.
- **CSP:** nonce per request (`apps/web/src/middleware.ts`), `'strict-dynamic'`, no
  `'unsafe-inline'` for scripts; inline style attributes allowed. Every page now renders per
  request. Checked in a browser on the production build: all scripts carry the nonce, no
  violations, and an injected inline event handler does not run.
- **Images:** one multi-target `deploy/docker/Dockerfile`; base images pinned by tag, and
  each release is recorded by image **digest** in `release.env` (not base-image digests,
  which need Docker to look up). `pnpm deploy --prod` builds the API package; tested
  locally by starting the pruned package against PostgreSQL. `standalone` web output is
  enabled only inside the image build (`NEXT_OUTPUT`), because it needs symlinks that
  Windows development machines may not allow.
- **Not runnable on the development machine** (no Docker, no Linux): image builds, Trivy,
  Caddy validation, compose validation and ShellCheck run in the new **Images** workflow;
  backups, restore tests and TLS are proved on the first server build
  ([server-build.md](../../security/runbooks/server-build.md)).

## Out of scope

Multiple API instances, a separate database server or managed PostgreSQL (scaling path in
`deployment.md`), the SMS provider (ADR-0003 I3), email, and real hospital data — staging
holds synthetic data only.
