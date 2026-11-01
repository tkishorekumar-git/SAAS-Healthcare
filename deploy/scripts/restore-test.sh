#!/usr/bin/env bash
# Monthly restore test on the BACKUP VPS (ADR-0006). Root's cron:
#   30 4 1 * *  /opt/kenisha-backup/restore-test.sh
#
# Restores the newest daily snapshot into a throwaway PostgreSQL container with no network,
# replays WAL to the end, and checks that the restored database is usable. Writes one line
# to /var/log/kenisha-restore-tests.log (kept as evidence) and exits non-zero on failure.
# Prints counts only - never table contents.
set -Eeuo pipefail
umask 077

CONF=/etc/kenisha-backup/backup.env   # POSTGRES_IMAGE=..., cipher pass in CIPHER_FILE
# shellcheck source=/dev/null
source "$CONF"
LOG=/var/log/kenisha-restore-tests.log
SNAPSHOT=$(find /srv/kenisha-backup/snapshots -maxdepth 1 -name 'daily-*' -printf '%p\n' | sort -r | head -n 1)
[[ -n "$SNAPSHOT" ]] || { echo "$(date -u +%FT%TZ) FAIL no daily snapshot" >>"$LOG"; exit 1; }

WORK=$(mktemp -d /srv/kenisha-backup/restore-test.XXXXXX)
NAME="kenisha-restore-test-$$"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf -- "$WORK"; }
trap cleanup EXIT
mkdir -p "$WORK/data"
chown 999:999 "$WORK/data"   # postgres user in the image

started=$(date +%s)
result=FAIL
detail=""

run_pg() {
  docker run --rm --network none -u postgres \
    -e PGBACKREST_REPO1_CIPHER_PASS="$(cat "$CIPHER_FILE")" \
    -v "$SNAPSHOT:/var/lib/pgbackrest:ro" \
    -v "$WORK/data:/var/lib/postgresql" \
    "$POSTGRES_IMAGE" "$@"
}

if run_pg sh -c 'mkdir -p /var/lib/postgresql/18/docker && pgbackrest --stanza=kenisha --log-path=/tmp --lock-path=/tmp --archive-mode=off restore' >/dev/null; then
  docker run -d --name "$NAME" --network none -u postgres \
    -e PGBACKREST_REPO1_CIPHER_PASS="$(cat "$CIPHER_FILE")" \
    -v "$SNAPSHOT:/var/lib/pgbackrest:ro" \
    -v "$WORK/data:/var/lib/postgresql" \
    "$POSTGRES_IMAGE" postgres -c archive_mode=off >/dev/null
  for _ in $(seq 1 120); do
    if docker exec "$NAME" psql -U kenisha_admin -d kenisha -tAc "SELECT NOT pg_is_in_recovery()" 2>/dev/null | grep -q t; then
      counts=$(docker exec "$NAME" psql -U kenisha_admin -d kenisha -tAc \
        "SELECT (SELECT count(*) FROM kenisha.tenants) || ' tenants, ' ||
                (SELECT count(*) FROM kenisha._prisma_migrations WHERE finished_at IS NOT NULL) || ' migrations, newest audit ' ||
                coalesce((SELECT max(created_at)::text FROM kenisha.audit_events), 'none')")
      result=PASS
      detail="$counts"
      break
    fi
    sleep 5
  done
  [[ "$result" == PASS ]] || detail="database did not finish recovery"
else
  detail="pgbackrest restore failed"
fi

echo "$(date -u +%FT%TZ) $result snapshot=$(basename "$SNAPSHOT") seconds=$(( $(date +%s) - started )) $detail" >>"$LOG"
[[ "$result" == PASS ]]
