#!/bin/bash
# Start backend_live when NAS media is mounted via WSL (Docker Desktop / Windows).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

bash "$SCRIPT_DIR/mount_nas_media_wsl.sh"

COMPOSE_ARGS=()
if [[ -f backend_live/.env ]]; then
  COMPOSE_ARGS=(--env-file backend_live/.env)
fi

exec docker compose "${COMPOSE_ARGS[@]}" up -d --build "$@"
