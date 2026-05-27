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
cp index.html pages_publish/
cp -r frontend/dist/. pages_publish/dashboardtestv1/
printf '%s\n' '/dashboardtestv1/* /dashboardtestv1/index.html 200' > pages_publish/_redirects
echo "OK: $ROOT/pages_publish  (root index + /dashboardtestv1 + _redirects)"
