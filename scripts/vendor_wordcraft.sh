#!/usr/bin/env bash
# Download WordCraft web build into dgsappv1/wordcraft/ (same-origin embed for Workbench).
# Binaries are gitignored; run from build_pages_publish or locally before testing Edit Proposal.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${WORDCRAFT_WEB_VERSION:-0.17.0}"
DEST="$ROOT/dgsappv1/wordcraft"
MARKER="$DEST/.vendor-version"
URL="https://github.com/storytold/wordcraft/releases/download/v${VERSION}/wordcraft-web-${VERSION}.zip"

if [[ -f "$MARKER" ]] && [[ "$(cat "$MARKER")" == "$VERSION" ]] && [[ -f "$DEST/index.html" ]]; then
  echo "OK: WordCraft web v${VERSION} already vendored at $DEST"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
ZIP="$TMP/wordcraft-web.zip"
echo "Downloading WordCraft web v${VERSION}…"
curl -fsSL -o "$ZIP" "$URL"
python3 - "$ZIP" "$TMP/extract" "$DEST" "$VERSION" <<'PY'
import pathlib, shutil, sys, zipfile

zip_path = pathlib.Path(sys.argv[1])
extract_root = pathlib.Path(sys.argv[2])
dest = pathlib.Path(sys.argv[3])
version = sys.argv[4]

extract_root.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(zip_path) as z:
    z.extractall(extract_root)
inners = [p for p in extract_root.iterdir() if p.is_dir()]
src = inners[0] if len(inners) == 1 else extract_root
readme = dest / "README.md"
readme_text = readme.read_text(encoding="utf-8") if readme.is_file() else None
if dest.exists():
    shutil.rmtree(dest)
shutil.copytree(src, dest)
(dest / ".vendor-version").write_text(version + "\n", encoding="utf-8")
if readme_text:
    (dest / "README.md").write_text(readme_text, encoding="utf-8")
print(f"Vendored WordCraft web v{version} → {dest}")
PY
