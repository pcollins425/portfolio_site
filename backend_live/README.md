# Backend — **live / tunnel** (`backend_live`)

Default **`http://127.0.0.1:9001`**. Same routes as **`backend_local`**; tuned for **`API_RELOAD=false`** in **`.env.example`**.

```powershell
cd E:\portfolio_site\backend_live
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
python run.py
```

Or **`scripts/run-backend-live.cmd`** / **`scripts/run-backend-live.sh`** from repo root.

Point your tunnel at this host/port. **`MSSQL_*`** = **`dashboard_perf_ro`** for revenue routes; **`MSSQL_FIELD_*`** = **`dgs_field_api`** for **`/api/asset/lookup`** and **`/api/field/health`**.

## Docker (same machine as **`cloudflared`**)

1. Create **`backend_live/.env`** from **`.env.example`** (ignored by Git — not copied into the image).
2. From **repo root**:

   ```bash
   docker compose up -d --build
   ```

3. Smoke test on the host: **`curl http://127.0.0.1:9001/health`**

**Compose** maps **`127.0.0.1:9001:9001`** so the API is **not** exposed on all interfaces. **`env_file`** reads **`./backend_live/.env`** when present (Compose marks it optional so a missing file does not block **`docker compose config`**; without **`MSSQL_*`**, the app will fail at runtime until you add one).

The image sets **`API_HOST=0.0.0.0`** inside the container; you do not need to duplicate that in **`.env`** unless you override it.
