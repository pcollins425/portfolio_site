# DGS Application (`dgsappv1/`)

Unified shell for **Dashboard**, **Warehouse**, and **Operations** — one sidebar, shared CSS, same API base.

Published to **`/dgsappv1/`** on Cloudflare Pages.

## Modules

| Page | Source | API |
|------|--------|-----|
| **Dashboard** | `frontend/` React app (iframe + subnav) | `/api/executive`, `/api/analyst/*`, … |
| **Warehouse** | `warehouseinventoryv1` logic | `/api/warehouse-inventory/*` |
| **Operations** | `emaintdemov1` grid + drawer | `/api/emaint-demo/*`, optional Google auth |

Legacy standalone apps remain at `/dashboardtestv1/`, `/warehouseinventoryv1/`, `/emaintdemov1/` until cutover.

## Local preview (static pages)

```bash
# Terminal 1 — API
scripts/run-backend-local.sh

# Terminal 2 — React dashboards (for iframe in dashboard.html)
cd frontend && npm run dev

# Terminal 3 — static shell
cd dgsappv1 && python -m http.server 8080
```

Open:

- `http://localhost:8080/dashboard.html?api=http://127.0.0.1:9002`
- `http://localhost:8080/warehouse.html?api=http://127.0.0.1:9002`
- `http://localhost:8080/operations.html?t=projects&api=http://127.0.0.1:9002`

Dashboard iframe loads `http://localhost:5173` automatically on localhost.

## Production build

From repo root:

```bash
scripts/build_pages_publish.sh
```

Builds React twice: `/dashboardtestv1/` (legacy) and `/dgsappv1/dashboard/` (unified app). Output includes full **`pages_publish/dgsappv1/`**.

## Shared styles

**`assets/dgs.css`** — Office Management direction from Paper style guide (`--sidebar-bg: #5a85d6`, `--accent: #e8734a`).

Original modules are unchanged; this folder is the integration target.
