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

Point your tunnel at this host/port. **`MSSQL_*`** = **`dashboard_perf_ro`** for revenue routes; **`MSSQL_FIELD_*`** = **`dgs_field_api`** for **`/api/asset/lookup`**, **`/api/field/health`**, and **`/api/emaint-demo/*`** (read-only on **`compinfo_landing`**, **`work_orders`**, **`emaint_landing`**).

## eMaint demo auth (Google Workspace)

**`GET /api/emaint-demo/*`** requires a Bearer JWT when **`EMAINT_DEMO_AUTH_REQUIRED=true`** (default). Sign-in uses Google OAuth restricted to **`@dynamicgamingsolutions.com`**, then loads **`employees.employee_roles`** + role permissions.

**`.env` (add):** `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `EMAINT_DEMO_JWT_SECRET` (long random string), `EMAINT_DEMO_OAUTH_REDIRECT_URI` (e.g. `https://api.collinsmediallc.com/api/auth/google/callback`), `EMAINT_DEMO_FRONTEND_ORIGIN` (e.g. `https://www.collinsmediallc.com`).

**Google Cloud Console:** OAuth client type **Web application**; authorized redirect URI = **`EMAINT_DEMO_OAUTH_REDIRECT_URI`**. Scopes: OpenID / email / profile (handled by the app).

**SQL (once, privileged login):**

1. `scripts/sql/seed_emaint_demo_permissions.sql` — adds role **`RT-032`** and demo overrides (no deletes).
2. `scripts/sql/grant_emaint_demo_employee_lookup.sql` — **`GRANT SELECT`** on **`employees.employee_roles`** / **`roles`** for **`MSSQL_USER`** (set `EMAINT_DEMO_AUTH_DB_USER` or edit script).

**Per-table permission areas:** `emaint_demo_projects`, `emaint_demo_work_orders`, `emaint_demo_compinfo`, `emaint_demo_inventory`, `emaint_demo_purchase_orders`. Levels match AppSheet (`READ_ONLY`, `ADDS_AND_UPDATES`, …).

**Local dev without login:** `EMAINT_DEMO_AUTH_REQUIRED=false` in **`.env`**.

**UI:** `emaintdemov1/login.html` → Google → returns to table view with JWT in **`sessionStorage`**.

## Docker (same machine as **`cloudflared`**)

1. Create **`backend_live/.env`** from **`.env.example`** (ignored by Git — not copied into the image).
2. From **repo root**:

   ```bash
   docker compose up -d --build
   ```

3. Smoke test on the host: **`curl http://127.0.0.1:9001/health`**

**Compose** maps **`127.0.0.1:9001:9001`** so the API is **not** exposed on all interfaces. **`env_file`** reads **`./backend_live/.env`** when present (Compose marks it optional so a missing file does not block **`docker compose config`**; without **`MSSQL_*`**, the app will fail at runtime until you add one).

The image sets **`API_HOST=0.0.0.0`** inside the container; you do not need to duplicate that in **`.env`** unless you override it.
