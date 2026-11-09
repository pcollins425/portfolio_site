# WordCraft web (vendored)

Same-origin WordCraft build for Project Workbench Edit Proposal (`?host=parent`).

**Not committed** — binaries are large (~60 MB wasm). Vendor before local preview or Cloudflare publish:

```bash
bash scripts/vendor_wordcraft.sh
```

`scripts/build_pages_publish.sh` runs that automatically.

Pinned by `WORDCRAFT_WEB_VERSION` (default `0.17.0`) from
https://github.com/storytold/wordcraft/releases
