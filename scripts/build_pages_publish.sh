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
# WordCraft wasm is ~58MB raw; Workers assets max is 25 MiB. Ship *.wasm.gz (~21MB).
# Cloudflare strips Content-Encoding from Worker responses, so the browser must
# fetch the .gz and decompress with DecompressionStream (patched into index.html).
python3 - <<'PY'
from pathlib import Path
import gzip
import re

root = Path("pages_publish/dgsappv1/wordcraft")
if not root.is_dir():
    raise SystemExit(0)

wasm_files = list(root.glob("*.wasm"))
for wasm in wasm_files:
    gz = Path(str(wasm) + ".gz")
    gz.write_bytes(gzip.compress(wasm.read_bytes(), compresslevel=9))
    wasm.unlink()
    print(f"WordCraft asset: {gz.name} ({gz.stat().st_size / 1024 / 1024:.1f} MiB gzip)")

index = root / "index.html"
if index.is_file() and wasm_files:
    html = index.read_text(encoding="utf-8")
    # Drop SRI — hashes are for raw wasm, we load gzip and inflate in-page.
    html = re.sub(r'\s+integrity="[^"]*"', "", html)
    html = re.sub(
        r"as=\"fetch\"\s+type=\"application/wasm\"",
        'as="fetch" type="application/octet-stream"',
        html,
    )
    html = html.replace(".wasm\"", ".wasm.gz\"")
    html = html.replace(".wasm'", ".wasm.gz'")
    # Trunk bootstrap: inflate .wasm.gz before wasm-bindgen init.
    html = re.sub(
        r"import init, \* as bindings from '(\./wordcraft-web-[^']+\.js)';\s*"
        r"const wasm = await init\(\{ module_or_path: '(\./wordcraft-web-[^']+_bg\.wasm\.gz)' \}\);",
        r"""import init, * as bindings from '\1';
const loading = document.getElementById('wordcraft_loading');
if (loading) loading.textContent = 'Downloading WordCraft…';
const gzRes = await fetch('\2');
if (!gzRes.ok) throw new Error('WordCraft wasm download failed: HTTP ' + gzRes.status);
if (loading) loading.textContent = 'Inflating WordCraft…';
const wasmBytes = await new Response(gzRes.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
if (loading) loading.textContent = 'Starting WordCraft…';
const wasm = await init({ module_or_path: wasmBytes });""",
        html,
        count=1,
    )
    index.write_text(html, encoding="utf-8")
    print("WordCraft index.html patched for browser-side gzip inflate")
PY
echo "OK: $ROOT/pages_publish  (Collins Media shop + /dashboardtestv1 SPA + /dgsappv1 + legacy demos)"
