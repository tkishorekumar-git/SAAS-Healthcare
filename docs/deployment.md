# Deployment (planned)

**Status:** design only, decided in [ADR-0006](architecture/adr/0006-production-deployment.md).
Production Dockerfiles, Caddy configuration and backup automation are delivered in
Milestone 5b (see [roadmap.md](roadmap.md)).

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

Decided in [ADR-0006](architecture/adr/0006-production-deployment.md): pgBackRest with
continuous WAL archiving and weekly full backups, pulled by a separate backup VPS in India,
encrypted before storage, with a monthly automated restore test. Retention to be confirmed
against legal retention rules ([data-retention.md](security/runbooks/data-retention.md)).

## Scaling path

Single VPS → separate DB VPS (or managed PostgreSQL) → multiple API instances behind Caddy.
