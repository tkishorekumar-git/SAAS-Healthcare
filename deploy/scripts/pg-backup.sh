#!/usr/bin/env bash
# Scheduled backups on the application server (ADR-0006), run by root's cron:
#   15 2 * * 0   /opt/kenisha/bin/pg-backup.sh full
#   15 2 * * 1-6 /opt/kenisha/bin/pg-backup.sh diff
# WAL is archived continuously by PostgreSQL itself (archive_command); these backups are
# the restore starting points. Logs counts and status only.
set -Eeuo pipefail

TYPE="${1:-}"
[[ "$TYPE" == "full" || "$TYPE" == "diff" ]] || { echo "usage: pg-backup.sh full|diff" >&2; exit 2; }

docker compose --project-directory /opt/kenisha -f /opt/kenisha/compose.yml \
  --env-file /opt/kenisha/release.env \
  exec -T -u postgres postgres pgbackrest --stanza=kenisha --type="$TYPE" backup

docker compose --project-directory /opt/kenisha -f /opt/kenisha/compose.yml \
  --env-file /opt/kenisha/release.env \
  exec -T -u postgres postgres pgbackrest --stanza=kenisha info --output=text \
  | grep -E 'status|full backup|diff backup|wal archive min/max' || true
