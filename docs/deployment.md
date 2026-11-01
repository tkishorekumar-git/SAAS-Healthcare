# Deployment

Decided in [ADR-0006](architecture/adr/0006-production-deployment.md); built in Milestone 5b.
Step-by-step server build: [server-build.md](security/runbooks/server-build.md). Backups:
[backup-restore.md](security/runbooks/backup-restore.md).

## Topology (one VPS per environment; staging now)

```
Internet ──► Caddy :443 (automatic TLS 1.2/1.3, HSTS, request size limit)
               ├── staging-app.<domain>         ──► web (Next.js)
               │      └── /api/*                ──► api (NestJS)   same origin for browsers
               └── staging-api.<domain>         ──► api            for the Android app
                                                     ├── postgres 18 + pgBackRest  (internal network)
                                                     └── redis 7.4 (rate limits)   (internal network)
Backup VPS ── pulls the encrypted pgBackRest repository every 5 minutes (read-only SSH)
```

- Hostinger KVM VPSes in India (ADR-0002 D4), Ubuntu LTS, firewall 22/80/443 (backup VPS:
  22 only), SSH keys only, data on a LUKS-encrypted volume.
- Containers run non-root with read-only file systems, no capabilities and
  `no-new-privileges`; PostgreSQL and Redis have no route to the internet.

## Files

| Path                                               | Purpose                                                         |
| -------------------------------------------------- | --------------------------------------------------------------- |
| `deploy/docker/Dockerfile`                         | `api`, `web`, `migrate` and `postgres` (with pgBackRest) images |
| `deploy/compose.yml`                               | The server stack                                                |
| `deploy/caddy/Caddyfile`                           | TLS, HSTS, routing, log redaction                               |
| `deploy/postgres/`                                 | pgBackRest configuration                                        |
| `deploy/scripts/deploy.sh`                         | Release: pull by commit, pin digests, migrate, start, roll back |
| `deploy/scripts/pg-backup.sh`                      | Weekly full / daily differential backups                        |
| `deploy/scripts/backup-pull.sh`, `restore-test.sh` | Backup VPS: pull + snapshots, monthly restore test              |
| `deploy/env/*.example`                             | Server configuration templates (placeholders only)              |

## Release flow

1. Merge to `main`. **CI** tests everything; **Images** validates the server configuration,
   builds the four images, scans them with Trivy and pushes them to GHCR as `sha-<commit>`.
2. Actions → **Deploy** → enter the commit SHA → approve (GitHub environment `staging`).
3. The server's `deploy.sh` pulls the images, records their digests in `release.env`, runs
   migrations, starts the release and waits for readiness — or returns to the previous
   release.

Migrations are append-only and must stay compatible with the previous API version, so a
code rollback never needs a schema rollback.

## Scaling path

Single VPS → separate database VPS (or managed PostgreSQL in India) → several API
instances behind Caddy (rate limits already shared through Redis).
