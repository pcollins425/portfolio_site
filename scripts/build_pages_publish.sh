#!/usr/bin/env bash
# Merge Collins Media root shop + production Vite app under **`/dashboardtestv1/`** for Cloudflare Workers assets.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Same-origin WordCraft for Workbench Edit Proposal (gitignored binaries).
bash "$ROOT/scripts/vendor_wordcraft.sh"
cd "$ROOT/frontend"
npm install
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-https://api.collinsmediallc.com}"
npm run build
npm run build:dgsapp
cd "$ROOT"
rm -rf pages_publish
mkdir -p pages_publish/dashboardtestv1
mkdir -p pages_publish/scannertestv1
mkdir -p pages_publish/emaintdemov1
mkdir -p pages_publish/warehouseinventoryv1
mkdir -p pages_publish/dgsappv1
mkdir -p pages_publish/marketing
mkdir -p pages_publish/apps
mkdir -p pages_publish/functions
mkdir -p pages_publish/practice
cp index.html shop.html about.html pages_publish/
cp -r marketing/. pages_publish/marketing/
cp -r apps/. pages_publish/apps/
cp -r functions/. pages_publish/functions/
cp -r practice/. pages_publish/practice/
cp -r frontend/dist/. pages_publish/dashboardtestv1/
cp scannertestv1/index.html pages_publish/scannertestv1/
cp -r emaintdemov1/. pages_publish/emaintdemov1/
cp -r warehouseinventoryv1/. pages_publish/warehouseinventoryv1/
cp -r dgsappv1/. pages_publish/dgsappv1/
echo "OK: $ROOT/pages_publish  (Collins Media shop + /dashboardtestv1 SPA + /dgsappv1 + legacy demos)"
