#!/usr/bin/env bash
# Merge root **coming soon** + production Vite app under **`/dashboardtestv1/`** for Cloudflare Pages.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/frontend"
npm install
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api.collinsmediallc.com}"
npm run build
cd "$ROOT"
rm -rf pages_publish
mkdir -p pages_publish/dashboardtestv1
mkdir -p pages_publish/scannertestv1
cp index.html pages_publish/
cp -r frontend/dist/. pages_publish/dashboardtestv1/
cp scannertestv1/index.html pages_publish/scannertestv1/
echo "OK: $ROOT/pages_publish  (coming soon + /dashboardtestv1 SPA + /scannertestv1 scanner demo)"
