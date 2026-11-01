# Runbook: backups, restore and disaster recovery

How Kenisha's database is backed up (ADR-0006 P2, P3), how to restore it, and how the
backups are proved to work.

## How it works

```
Application server                                   Backup server (India, separate VPS)
PostgreSQL ──archive_command──► pgBackRest repo       backup-pull.sh every 5 min
  (every WAL segment, at the     /srv/kenisha/          rsync over SSH, read-only key ──►
   latest every 5 minutes)        pgbackrest            current/ + hourly/daily/monthly
pg-backup.sh: weekly full,      (encrypted, AES-256,     hard-link snapshots
   daily differential             2 full backups kept)  restore-test.sh monthly
```

- **Encrypted before it is written** (pgBackRest repository encryption). The passphrase
  is in `/etc/kenisha/postgres.env` on the application server, in
  `/etc/kenisha-backup/cipher-pass` on the backup server, and **offline**.
- **Pulled, not pushed:** the backup server connects to the application server with a key
  that can only read the repository. The application server has no credentials for the
  backup server, so an attacker there cannot delete the off-site copies.
- **History:** 48 hourly, 35 daily and 12 monthly snapshots on the backup server.
- **Data-loss window:** at most about 10 minutes (5 for WAL to be archived, 5 for the next
  pull) if the application server is lost; otherwise point-in-time recovery to any second.

## Checks (weekly, 5 minutes)

- `tail /var/log/kenisha-backup-pull.log` on the backup server: recent `ok` lines, no `ALERT`.
- `tail /var/log/kenisha-restore-tests.log`: last month's line says `PASS`.
- On the application server: `pg-backup.sh` log shows the last full and diff backups.

A missing `ok` line for more than an hour, any `ALERT`, or a `FAIL` is an incident
([incident-response.md](incident-response.md), SEV-2).

## Restore test (automated, monthly)

`restore-test.sh` restores the newest daily snapshot into a throwaway container with no
network, replays WAL to the end and records tenant and migration counts. Evidence is the
log line with date, snapshot, duration and counts. Run it by hand after any change to the
backup setup.

## Restore after data loss or corruption

1. **Decide the target**: latest, or a time just before the damage (UTC).
2. **Stop writes**: `docker compose --env-file release.env stop api web` on the
   application server.
3. **Keep the damaged data**: `mv /srv/kenisha/postgres /srv/kenisha/postgres.damaged-<date>`,
   then `install -d -o 999 -g 999 /srv/kenisha/postgres`.
4. **Restore** (the local repository is used if intact; otherwise copy the chosen snapshot
   back from the backup server into `/srv/kenisha/pgbackrest` first):

   ```bash
   docker compose --env-file release.env run --rm -u postgres postgres \
     pgbackrest --stanza=kenisha --type=time "--target=<YYYY-MM-DD HH:MM:SS+00>" \
     --target-action=promote restore
   ```

   For "latest", leave out `--type`, `--target` and `--target-action`.

5. **Start and check**: `docker compose --env-file release.env up -d --wait`, then
   readiness, a test sign-in, and the newest audit events.
6. **Take a fresh full backup**: `pg-backup.sh full` (a restore starts a new timeline).
7. Record what was restored, to which point, and why.

## Disaster recovery (application server lost)

1. Build a new application server with [server-build.md](server-build.md) (sections 1–3),
   up to "Secrets"; reuse the same secrets from your offline store.
2. Copy the newest snapshot from the backup server to `/srv/kenisha/pgbackrest`.
3. Restore as above ("latest"), then deploy the last release
   (`deploy.sh <RELEASE_SHA from the old release.env or the GitHub deploy history>`).
4. Point DNS to the new server; re-run `stanza-create` is **not** needed (same stanza).
5. Update the backup server's `APP_HOST` and `known_hosts`.

Rehearse this at least once before the first real hospital and record the time it took.
