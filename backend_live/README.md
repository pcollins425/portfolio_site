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

Point your tunnel at this host/port. **`MSSQL_*`** = **`dashboard_perf_ro`** for revenue routes; **`MSSQL_FIELD_*`** = **`dgs_field_api`** for **`/api/asset/lookup`**, **`/api/field/health`**, and **`/api/emaint-demo/*`**. **`compinfo_landing.status`** updates after scan prep moves require **`GRANT UPDATE`** on landing (see **`scripts/sql/grant_compinfo_landing_status_field_api.sql`** in cursor-assistant repo).

**Asset prep status (scan → move):** **`POST /api/emaint-demo/compinfo/prep-status`** calls eMaint **Record** — set **`EMAINT_SERVER_URL`**, **`EMAINT_USER`**, **`EMAINT_PASSWORD`** in **`.env`** (same as other eMaint scripts; typically from **`MASTER_CREDENTIALS_ENV`** on the Docker host).

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

**Auto-redeploy after git push:** from repo root, **`bash scripts/deploy-backend-docker.sh`** (pull + down + up **`--build`**). For unattended updates, see **`scripts/README.md`** — cron polling (**`check-backend-updates.sh`**) or a GitHub webhook (**`github-webhook-listener.py`**).

## Assistant (Cursor SDK) in Docker

The **`/api/assistant/*`** routes and **`dgsappv1/assistant.html`** UI are already in this repo. In Docker, the API container needs two things beyond a normal deploy:

1. **Mount the workspace** — default **`../cursor-assistant`** (sibling folder). Override with **`ASSISTANT_WORKSPACE_HOST`** in **`backend_live/.env`** and run compose with **`--env-file backend_live/.env`** (or use **`scripts/deploy-backend-docker.sh`**, which does this automatically).
2. **`CURSOR_API_KEY`** in **`backend_live/.env`** — user or team service-account key from [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations).

### One-time setup (SQL server)

```powershell
# 1) Workspace clone (agent files, scripts, knowledge)
cd "C:\Users\DGS Slot Server"
git clone https://github.com/pcollins425/cursor-assistant.git
# or: cd cursor-assistant && git pull origin main

# 2) portfolio_site — pull latest (sibling ../cursor-assistant mount is automatic)

# 3) API secrets in backend_live\.env only
#    CURSOR_API_KEY=cursor_...
#    Remove ASSISTANT_WORKSPACE_HOST unless the clone is not a sibling folder

docker compose --env-file backend_live\.env up -d --build
```

### Verify

```bash
curl -s http://127.0.0.1:9001/api/assistant/health
```

Expect **`workspace_exists: true`**, **`cursor_api_key_configured: true`**, **`cursor_sdk_installed: true`**.

Inside the container (optional):

```bash
docker compose exec backend_live cursor-sdk-bridge --help
docker compose exec backend_live ls /workspace/agents
```

### Secret locations (two files)

| Secret | File | Purpose |
|--------|------|---------|
| **`CURSOR_API_KEY`** | **`backend_live/.env`** | SDK auth — stays on the API server, not in git |
| MSSQL, Gmail, etc. | **`cursor-assistant/.env`** on host (visible in container as **`/workspace/.env`**) | Agent runtime; editable via Assistant UI **Secrets** drawer |

Do **not** put **`CURSOR_API_KEY`** in the workspace `.env` unless you have a specific reason — keep it in **`backend_live/.env`** only.

### Notes

- **`cursor-sdk`** ships **`cursor-sdk-bridge`** inside the image; no Cursor IDE install on the host.
- The mount is **read-write** so agents can edit files and persist session index under **`/workspace/data/assistant_sessions.json`**.
- Static UI: run **`scripts/build_pages_publish.sh`** and deploy **`pages_publish/`** if **`assistant.html`** is not yet on Cloudflare Pages.
