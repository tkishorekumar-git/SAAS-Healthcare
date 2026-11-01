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

- The backup VPS **pulls** backups: it is the pgBackRest repository host and connects to the
  application server, never the other way round. A compromised application server has no
  credentials to reach, change or delete its backups.
- Backups are encrypted by pgBackRest (repository encryption, AES-256) before they are
  written; the passphrase is kept on the backup VPS and offline, never on the application
  server.
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
                                       ▲
               backup VPS (pgBackRest repository) pulls over SSH, encrypts, keeps history
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

## Out of scope

Multiple API instances, a separate database server or managed PostgreSQL (scaling path in
`deployment.md`), the SMS provider (ADR-0003 I3), email, and real hospital data — staging
holds synthetic data only.
