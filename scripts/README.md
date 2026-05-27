# `scripts/` — operations

| File | Role |
|------|------|
| **`run_sql_file.py`** | Apply **`.sql`** files (split on **`GO`**). Loads **`MASTER_CREDENTIALS_ENV`** → **`../.env`** → **`../backend_local/.env`**. **`pip install -r scripts/requirements.txt`**. |
| **`run-backend-local.sh` / `.cmd`** | **`cd ../backend_local && python run.py`** |
| **`run-backend-live.sh` / `.cmd`** | **`cd ../backend_live && python run.py`** |
| **`sql/dashboard_perf_ro/`** | View **`dashboard.vw_performance_report`**, **`dashboard_perf_ro`** grants — see **`sql/dashboard_perf_ro/README.md`**. |
