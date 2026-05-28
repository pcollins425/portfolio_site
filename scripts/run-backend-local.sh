#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend_local"

if [[ -d "$ROOT/backend_local/.venv" ]]; then
  PY="$ROOT/backend_local/.venv/bin/python"
else
  PY="python3"
fi

"$PY" run.py
