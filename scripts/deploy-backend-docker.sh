#!/usr/bin/env bash
# Pull latest repo (optional), rebuild, and restart backend_live via Docker Compose.
#
# From repo root:
#   bash scripts/deploy-backend-docker.sh
#
# Skip git pull (e.g. webhook already verified the push):
#   bash scripts/deploy-backend-docker.sh --no-pull
#
# Env:
#   DEPLOY_BRANCH=main
#   DEPLOY_LOCK_FILE=/tmp/portfolio-backend-deploy.lock
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRANCH="${DEPLOY_BRANCH:-main}"
LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/portfolio-backend-deploy.lock}"
DO_PULL=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-pull)
      DO_PULL=false
      shift
      ;;
    -h|--help)
      sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Deploy already in progress (lock: $LOCK_FILE)" >&2
  exit 0
fi

log() {
  echo "[$(date -Is)] $*"
}

if [[ "$DO_PULL" == true ]]; then
  log "Fetching and pulling origin/$BRANCH..."
  git fetch origin "$BRANCH"
  git pull --ff-only origin "$BRANCH"
fi

log "Stopping containers..."
docker compose down

log "Building and starting containers..."
docker compose up -d --build

log "Waiting for /health..."
for _ in $(seq 1 30); do
  if curl -sf http://127.0.0.1:9001/health >/dev/null; then
    log "Backend healthy on http://127.0.0.1:9001"
    exit 0
  fi
  sleep 2
done

log "ERROR: health check failed after 60s" >&2
docker compose logs --tail=80 backend_live >&2 || true
exit 1
