# DGS Application (`dgsappv1/`)

Unified shell for **Dashboard**, **Warehouse**, and **Operations** — one sidebar, shared CSS, same API base.

Published to **`/dgsappv1/`** on Cloudflare Pages.

## Modules

| Page | Source | API |
|------|--------|-----|
| **Dashboard** | `frontend/` React app embedded in page (no iframe) | `/api/executive`, `/api/analyst/*`, … |
| **Slot Master** | State → Tribe → Casino cascade, active list, detail drawer, direct-edit attributes | `/api/slot-master/*` |
| **Contracts** | Google sheet sync browse + detail drawer | `/api/contracts/*` |
| **Warehouse** | `warehouseinventoryv1` logic | `/api/warehouse-inventory/*` |
| **Operations** | `emaintdemov1` grid + drawer | `/api/emaint-demo/*`, optional Google auth |

Legacy standalone apps remain at `/dashboardtestv1/`, `/warehouseinventoryv1/`, `/emaintdemov1/` until cutover.

## Local preview (static pages)

```bash
# Terminal 1 — API
scripts/run-backend-local.sh

# Terminal 2 — React dashboards (embedded in dashboard.html, port 5174)
cd frontend && npm run dev:dgsapp

# Terminal 3 — static shell
cd dgsappv1 && python -m http.server 8080
```

Open:

- `http://localhost:8080/slot_master.html?api=http://127.0.0.1:9002`
- `http://localhost:8080/contracts.html?api=http://127.0.0.1:9002`
- `http://localhost:8080/dashboard.html?api=http://127.0.0.1:9002`
- `http://localhost:8080/warehouse.html?api=http://127.0.0.1:9002`
- `http://localhost:8080/operations.html?t=projects&api=http://127.0.0.1:9002`

Dashboard bundle loads from Vite on **port 5174** automatically on localhost (`npm run dev:dgsapp`). Subnav switches views without reload.

## Production build

From repo root:

```bash
scripts/build_pages_publish.sh
```

Builds React twice: `/dashboardtestv1/` (legacy) and `/dgsappv1/dashboard/` (unified app). Output includes full **`pages_publish/dgsappv1/`**.

## Shared styles

**`assets/dgs.css`** — Office Management direction from Paper style guide (`--sidebar-bg: #5a85d6`, `--accent: #e8734a`).

Original modules are unchanged; this folder is the integration target.
