#!/usr/bin/env bash
# Runs on the BACKUP VPS (ADR-0006 P2), never on the application server. Root's cron:
#   */5 * * * *  /opt/kenisha-backup/backup-pull.sh
#
# Pulls the encrypted pgBackRest repository from the application server over SSH. The
# application server's authorized_keys restricts this key to read-only rsync of that one
# directory (rrsync -ro), so the application server holds no way to reach, change or
# delete anything here.
#
# Copies:  current/                 latest mirror (refreshed every 5 minutes)
#          snapshots/hourly-*       hard-link snapshots, kept 48 hours
#          snapshots/daily-*        hard-link snapshots, kept 35 days
#          snapshots/monthly-*      hard-link snapshots, kept 12 months
# rsync replaces changed files by writing new ones, so older snapshots keep their content
# even if the source is deleted or overwritten.
set -Eeuo pipefail
umask 077

CONF=/etc/kenisha-backup/backup.env       # APP_HOST=..., SSH_KEY=/root/.ssh/kenisha_pull
# shellcheck source=/dev/null
source "$CONF"
ROOT=/srv/kenisha-backup
CURRENT="$ROOT/current"
SNAPSHOTS="$ROOT/snapshots"
mkdir -p "$CURRENT" "$SNAPSHOTS"

exec 9>/run/kenisha-backup-pull.lock
flock -n 9 || exit 0

log() { printf '%s backup-pull: %s\n' "$(date -u +%FT%TZ)" "$*"; }

before_files=$(find "$CURRENT" -type f | wc -l)
rsync --archive --delete --partial-dir=.rsync-partial \
  -e "ssh -i $SSH_KEY -o BatchMode=yes -o StrictHostKeyChecking=yes" \
  "kenisha-backup@$APP_HOST:" "$CURRENT/"
after_files=$(find "$CURRENT" -type f | wc -l)

# A sudden large drop means files were removed at the source: keep evidence, raise alarm.
if (( before_files > 20 && after_files * 2 < before_files )); then
  log "ALERT: repository shrank from $before_files to $after_files files - check the application server"
  cp -al "$CURRENT" "$SNAPSHOTS/alert-$(date -u +%Y%m%dT%H%M%SZ)"
fi

snapshot() {
  local name="$SNAPSHOTS/$1"
  [[ -e "$name" ]] || cp -al "$CURRENT" "$name"
}
snapshot "hourly-$(date -u +%Y%m%dT%H)"
snapshot "daily-$(date -u +%Y%m%d)"
snapshot "monthly-$(date -u +%Y%m)"

prune() {
  local prefix=$1 keep=$2
  find "$SNAPSHOTS" -maxdepth 1 -name "$prefix-*" -printf '%f\n' | sort -r | tail -n +"$((keep + 1))" |
    while read -r old; do rm -rf -- "${SNAPSHOTS:?}/$old"; done
}
prune hourly 48
prune daily 35
prune monthly 12

log "ok: $after_files files"
