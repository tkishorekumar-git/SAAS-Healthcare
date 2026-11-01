#!/usr/bin/env bash
# Deploys one release on the application server (ADR-0006). Installed as
# /opt/kenisha/bin/deploy.sh (root:root 0755) and run as root - by the operator, or by the
# GitHub deploy workflow through the deploy user's forced SSH command:
#
#   deploy.sh <40-character git commit SHA>
#
# Steps: pull the four images built for that commit, pin them by digest, run migrations,
# start the new containers, wait for readiness; on failure, return to the previous release.
set -Eeuo pipefail
umask 077

STACK_DIR=/opt/kenisha
RELEASE="$STACK_DIR/release.env"
PREVIOUS="$STACK_DIR/release.env.previous"
REGISTRY="${KENISHA_REGISTRY:-$(sed -n 's/^REGISTRY=//p' "$STACK_DIR/registry.env")}"

log() { printf '%s deploy: %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

# The deploy key's forced command passes the requested SHA via SSH_ORIGINAL_COMMAND.
SHA="${1:-${SSH_ORIGINAL_COMMAND:-}}"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "expected a 40-character commit SHA"
[[ "$REGISTRY" =~ ^ghcr\.io/[a-z0-9-]+$ ]] || die "REGISTRY in $STACK_DIR/registry.env must be ghcr.io/<owner>"

exec 9>/run/kenisha-deploy.lock
flock -n 9 || die "another deployment is running"

compose() { docker compose --project-directory "$STACK_DIR" -f "$STACK_DIR/compose.yml" --env-file "$RELEASE" "$@"; }

# Resolve each image to an immutable digest, so the release record says exactly what ran.
declare -A DIGESTS
for name in api web migrate postgres; do
  ref="$REGISTRY/kenisha-$name:sha-$SHA"
  log "pulling $ref"
  docker pull --quiet "$ref" >/dev/null || die "image $ref not found (did the image workflow pass?)"
  DIGESTS[$name]="$(docker image inspect --format '{{index .RepoDigests 0}}' "$ref")"
done

cp "$RELEASE" "$PREVIOUS"
next="$(mktemp)"
grep -vE '^(API|WEB|MIGRATE|POSTGRES)_IMAGE=|^RELEASE_SHA=' "$RELEASE" >"$next" || true
{
  echo "RELEASE_SHA=$SHA"
  echo "API_IMAGE=${DIGESTS[api]}"
  echo "WEB_IMAGE=${DIGESTS[web]}"
  echo "MIGRATE_IMAGE=${DIGESTS[migrate]}"
  echo "POSTGRES_IMAGE=${DIGESTS[postgres]}"
} >>"$next"
install -m 0644 "$next" "$RELEASE"
rm -f "$next"

rollback() {
  log "rolling back to the previous release"
  install -m 0644 "$PREVIOUS" "$RELEASE"
  compose up -d --wait --wait-timeout 180 || log "ERROR: rollback did not become healthy - investigate now"
  exit 1
}
trap rollback ERR

# Migrations are append-only and must stay compatible with the previous API version
# (CLAUDE.md rule 9), so a rollback of the code never needs a rollback of the schema.
log "running database migrations"
compose up -d --wait --wait-timeout 120 postgres redis
compose run --rm migrate

log "starting release $SHA"
compose up -d --wait --wait-timeout 180 --remove-orphans

log "checking readiness"
for _ in $(seq 1 30); do
  if compose exec -T api node -e "fetch('http://127.0.0.1:4000/api/v1/health/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"; then
    trap - ERR
    log "release $SHA is live"
    docker image prune --force --filter "until=720h" >/dev/null || true
    exit 0
  fi
  sleep 2
done
false
