#!/usr/bin/env bash
# Poll origin for backend-related changes and redeploy when HEAD moves.
#
# Cron example (every 5 minutes):
#   */5 * * * * cd /path/to/portfolio_site && bash scripts/check-backend-updates.sh >> /var/log/portfolio-backend-deploy.log 2>&1
#
# Env:
#   DEPLOY_BRANCH=main
#   BACKEND_DEPLOY_PATHS=backend_live/ docker-compose.yml
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

BRANCH="${DEPLOY_BRANCH:-main}"
PATHS="${BACKEND_DEPLOY_PATHS:-backend_live/ docker-compose.yml}"

log() {
  echo "[$(date -Is)] $*"
}

git fetch origin "$BRANCH" --quiet

LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse "origin/$BRANCH")"

if [[ "$LOCAL" == "$REMOTE" ]]; then
  exit 0
fi

# shellcheck disable=SC2086
CHANGED="$(git diff --name-only "$LOCAL" "origin/$BRANCH" -- $PATHS || true)"
if [[ -z "$CHANGED" ]]; then
  log "origin/$BRANCH advanced ($LOCAL -> $REMOTE) but no backend paths changed; skipping deploy."
  git merge --ff-only "origin/$BRANCH" || git pull --ff-only origin "$BRANCH"
  exit 0
fi

log "Backend changes detected on origin/$BRANCH:"
echo "$CHANGED" | sed 's/^/  /'
bash "$ROOT/scripts/deploy-backend-docker.sh"
