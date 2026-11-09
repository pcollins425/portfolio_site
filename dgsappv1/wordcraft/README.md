# WordCraft web (vendored)

Same-origin WordCraft build for Project Workbench Edit Proposal (`?host=parent`).

**Not committed** — binaries are large (~58 MB wasm raw). Vendor before local preview:

```bash
bash scripts/vendor_wordcraft.sh
```

`scripts/build_pages_publish.sh` vendors automatically, then **gzips** the `.wasm` to `.wasm.gz` (~21 MiB) so it fits Cloudflare Workers’ **25 MiB** asset limit, and patches `index.html` so the browser downloads the `.gz` and inflates it with `DecompressionStream` (Cloudflare strips `Content-Encoding` from Worker responses, so that approach hung on “Loading…”).

Pinned by `WORDCRAFT_WEB_VERSION` (default `0.17.0`) from
https://github.com/storytold/wordcraft/releases
