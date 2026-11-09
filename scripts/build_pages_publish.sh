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
# WordCraft wasm is ~58MB raw; Workers assets max is 25 MiB. Ship gzip (~21MB)
# and let worker/spa.js serve it as application/wasm + Content-Encoding: gzip.
python3 - <<'PY'
from pathlib import Path
import gzip
root = Path("pages_publish/dgsappv1/wordcraft")
if root.is_dir():
    for wasm in root.glob("*.wasm"):
        gz = wasm.with_suffix(wasm.suffix + ".gz")  # file.wasm.gz
        data = wasm.read_bytes()
        gz.write_bytes(gzip.compress(data, compresslevel=9))
        wasm.unlink()
        print(f"WordCraft asset: {gz.name} ({gz.stat().st_size / 1024 / 1024:.1f} MiB gzip)")
PY
echo "OK: $ROOT/pages_publish  (Collins Media shop + /dashboardtestv1 SPA + /dgsappv1 + legacy demos)"
