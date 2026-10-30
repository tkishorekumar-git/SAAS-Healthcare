# Deployment (planned)

**Status:** design only. Production Dockerfiles, Caddy configuration and backup automation
are delivered in the deployment milestone (see [roadmap.md](roadmap.md)).

## Target topology — Hostinger VPS

```
Internet ──► Caddy :443 (auto TLS, HSTS, rate limits)
               ├── app.<domain>  ──► web  (Next.js, container)
               └── api.<domain>  ──► api  (NestJS, container)
                                       ├── postgres (container, private network, volume)
                                       └── redis    (container, private network, volume)
```

- All containers on a private Docker network; only Caddy publishes ports 80/443.
- Firewall (UFW): allow 22 (key-only SSH), 80, 443. Disable password SSH login.
- Images built in GitHub Actions, pushed to GHCR, pulled on the VPS (no builds on the server).
- Migrations run as a one-off `prisma migrate deploy` job before the new API version starts.
- Secrets live in a root-only `.env` on the server (or a secret manager), never in images.

## Backups

- Nightly `pg_dump` (custom format), encrypted (age/GPG), shipped off-site
  (e.g. S3-compatible object storage in an Indian region for data residency).
- Retention: 7 daily, 4 weekly, 12 monthly (confirm against legal retention rules).
- WAL archiving / point-in-time recovery evaluated once data volume justifies it.
- Monthly automated restore test into a scratch database.

## Scaling path

Single VPS → separate DB VPS (or managed PostgreSQL) → multiple API instances behind Caddy.
