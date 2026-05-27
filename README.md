# `portfolio_site` — everything in one repo

Static **coming-soon** site, **Master Revenue** dashboards (Vite + React), **two FastAPI backends** (local dev vs tunnel), **SQL** to provision the read-only façade, and **scripts** to run it all. No dependency on another GitHub tree for this product.

| Path | Purpose |
|------|---------|
| **`index.html`** | Cloudflare Pages — “coming soon” until you point Pages at `frontend/dist` or a separate project |
| **`local_test.html`** | Optional static probe (Python `http.server`) — not required if you use **`frontend/`** |
| **`frontend/`** | Master Revenue UI — React Router, Tailwind, Recharts → **`npm run dev`** → **`http://localhost:5173`**, proxies **`/api`** → **`backend_local`** (**`:9002`**) |
| **`backend_local/`** | Dev API — **`GET /api/health`**, **`/api/executive`**, **`/api/analyst/*`**, **`/api/finance/*`**, **`/api/performance/*`** over **`[dashboard].[vw_performance_report]`** |
| **`backend_live/`** | Same API surface on **`:9001`** for tunnel / production-style tests |
| **`scripts/`** | **`run_sql_file.py`** (DDL runner), **`run-backend-*.sh/.cmd`**, **`scripts/sql/dashboard_perf_ro/`** (view + grants) |

## Local dev (dashboards)

1. **SQL** — ensure **`dashboard.vw_performance_report`** exists and **`dashboard_perf_ro`** can read it. See **`scripts/sql/dashboard_perf_ro/README.md`**.
2. **Backend** — **`backend_local/.env`** with **`MSSQL_*`** (reader user is fine for the API).

   ```powershell
   cd E:\portfolio_site\backend_local
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   copy .env.example .env
   python run.py
   ```

   Or from repo root: **`scripts\run-backend-local.cmd`** (Windows) / **`scripts/run-backend-local.sh`** (Unix).

3. **Frontend**

   ```powershell
   cd E:\portfolio_site\frontend
   npm install
   npm run dev
   ```

**`GET /health`** on the API is a tiny liveness check. **`GET /api/health`** runs **`COUNT(*)`** on the façade (green banner in the UI when OK).

## Applying SQL from this repo

```bash
cd /path/to/portfolio_site
pip install -r scripts/requirements.txt   # pymssql + dotenv; use a venv if you prefer
export MASTER_CREDENTIALS_ENV=/path/to/privileged.env   # optional first load
python3 scripts/run_sql_file.py scripts/sql/dashboard_perf_ro/create_vw_dashboard_from_slot_master_revenue.sql
```

## Deploy vs local

- **Cloudflare Pages** — today: root **`index.html`**. Later: build **`frontend`** (**`npm run build`**, output **`dist`**) as its own Pages project.
- **API** — runs on your server; **`backend_live`** + tunnel (e.g. **`api.`** subdomain). It is **not** deployed with the static site.

## Layout philosophy

- **`backend_local`** / **`backend_live`** — same code shape, different default port and **`.env.example`** (reload on/off).
- **`scripts/`** — operational glue that used to live only in other workspaces; it’s vendored here on purpose.
