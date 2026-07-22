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
#   COMPOSE_ENV_FILE=backend_live/.env
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRANCH="${DEPLOY_BRANCH:-main}"
LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/portfolio-backend-deploy.lock}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-backend_live/.env}"
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

# Prefer an explicit host checkout that actually has FSR apply tooling.
# Compose volume interpolation only sees --env-file / shell env — not service env_file alone.
resolve_assistant_workspace_host() {
  if [[ -n "${ASSISTANT_WORKSPACE_HOST:-}" ]]; then
    return 0
  fi
  # Load from compose env file if present (without sourcing secrets into unrelated vars blindly).
  if [[ -f "$COMPOSE_ENV_FILE" ]]; then
    local from_file
    from_file="$(
      grep -E '^[[:space:]]*ASSISTANT_WORKSPACE_HOST=' "$COMPOSE_ENV_FILE" \
        | tail -n1 \
        | sed -E 's/^[[:space:]]*ASSISTANT_WORKSPACE_HOST=//' \
        | sed -E 's/^["'\'']//; s/["'\'']$//' \
        | tr -d '\r'
    )"
    if [[ -n "$from_file" ]]; then
      export ASSISTANT_WORKSPACE_HOST="$from_file"
      return 0
    fi
  fi
  local candidate
  for candidate in \
    "$ROOT/../cursor-assistant" \
    "$ROOT/../cursor_assistant" \
    "/mnt/c/Users/DGS Slot Server/cursor-assistant" \
    "C:/Users/DGS Slot Server/cursor-assistant"
  do
    if [[ -d "$candidate/scripts/fsr_intake" ]]; then
      export ASSISTANT_WORKSPACE_HOST="$candidate"
      log "Auto-set ASSISTANT_WORKSPACE_HOST=$ASSISTANT_WORKSPACE_HOST"
      return 0
    fi
  done
  log "WARNING: no ASSISTANT_WORKSPACE_HOST with scripts/fsr_intake — FSR Apply will 503"
}

COMPOSE_ARGS=()
if [[ -f "$COMPOSE_ENV_FILE" ]]; then
  COMPOSE_ARGS=(--env-file "$COMPOSE_ENV_FILE")
fi

resolve_assistant_workspace_host

log "Stopping containers..."
docker compose "${COMPOSE_ARGS[@]}" down

log "Building and starting containers..."
docker compose "${COMPOSE_ARGS[@]}" build --pull backend_live
docker compose "${COMPOSE_ARGS[@]}" up -d --force-recreate

log "Waiting for /health..."
for _ in $(seq 1 30); do
  if curl -sf http://127.0.0.1:9001/health >/dev/null; then
    log "Backend healthy on http://127.0.0.1:9001"
    if docker exec portfolio_backend_live test -d /workspace/scripts/fsr_intake 2>/dev/null; then
      log "FSR apply tooling OK at /workspace/scripts/fsr_intake"
    else
      log "WARNING: /workspace/scripts/fsr_intake missing in container — set ASSISTANT_WORKSPACE_HOST in backend_live/.env"
      docker exec portfolio_backend_live sh -c 'ls -la /workspace 2>/dev/null | head -20' >&2 || true
    fi
    exit 0
  fi
  sleep 2
done

log "ERROR: health check failed after 60s" >&2
docker compose logs --tail=80 backend_live >&2 || true
exit 1
