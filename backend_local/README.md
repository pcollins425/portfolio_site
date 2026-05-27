# Backend — **local / test** (`backend_local`)

Default **`http://127.0.0.1:9002`**.

## What it serves

- **`GET /health`** — light JSON (`ok`, `environment`) for probes.
- **`GET /api/health`** — tries **`SELECT COUNT(*) FROM [dashboard].[vw_performance_report]`** (dashboard banner + row count).
- **`GET /api/executive`**, **`/api/analyst/trends`**, **`/api/finance/*`**, **`/api/performance/themes-top`** — aggregates for the Vite app (same contract the UI expects).
- **`GET /api/v1/health`** — process metadata (bind, Python version).

## Setup

```powershell
cd E:\portfolio_site\backend_local
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Edit **`.env`**: **`MSSQL_*`** must reach the DB where **`dashboard.vw_performance_report`** lives. Use **`dashboard_perf_ro`** (or any principal with **`SELECT`** on that view). Optional **`MASTER_CREDENTIALS_ENV`** points at another **`.env`** loaded first (e.g. USB bundle); **`backend_local/.env`** overrides.

```powershell
python run.py
```

SQL to create the view and reader is under **`../scripts/sql/dashboard_perf_ro/`**.
