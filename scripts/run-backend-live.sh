#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend_live"

if [[ -d "$ROOT/backend_live/.venv" ]]; then
  PY="$ROOT/backend_live/.venv/bin/python"
else
  PY="python3"
fi

"$PY" run.py
