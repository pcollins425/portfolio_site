# `portfolio_site` — everything in one repo

Static **coming-soon** site (**`/`**), **Master Revenue** dashboards at **`/dashboardtestv1/`** (Vite + React), **two FastAPI backends** (local dev vs tunnel), **SQL** to provision the read-only façade, and **scripts** to run it all.

| Path | Purpose |
|------|---------|
| **`index.html`** | Cloudflare **`www`** — “coming soon” at site root (**`/`**). |
| **`local_test.html`** | Optional static probe (Python **`http.server`**) — not required if you use **`frontend/`**. |
| **`frontend/`** | Master Revenue UI — **`npm run dev`** → **`http://localhost:5173/`** (base **`/`**), proxies **`/api`** → **`backend_local`** (**`:9002`**). Production build uses base **`/dashboardtestv1/`**. |
| **`backend_local/`** | Dev API — **`GET /api/health`**, **`/api/executive`**, **`/api/analyst/*`**, **`/api/finance/*`**, **`/api/performance/*`** over **`[dashboard].[vw_performance_report]`** |
| **`backend_live/`** | Same API surface on **`:9001`** for tunnel / production-style tests |
| **`scripts/`** | **`run_sql_file.py`**, **`run-backend-*.sh/.cmd`**, **`build_pages_publish.*`**, **`scripts/sql/dashboard_perf_ro/`** |
| **`wrangler.toml`** | Workers static assets: upload **only** **`./pages_publish`** (never repo root / **`.git`**) |
| **`docker-compose.yml`** | **`backend_live`** image + host **`127.0.0.1:9001`** (for **`cloudflared`** on same machine) |

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

   Open **`http://localhost:5173/`** (dev stay at root; **not** under **`/dashboardtestv1`**).

**`GET /health`** on the API is a tiny liveness check. **`GET /api/health`** runs **`COUNT(*)`** on the façade (green banner in the UI when OK).

## Cloudflare — **Workers** + **`npx wrangler versions upload`**

If your build log shows **`Read … files from the assets directory /opt/buildhome/repo`**, Wrangler treated the **repo root** as the static folder, so **`.git/`** and everything else under the clone get scanned (and sometimes “uploaded”) as assets. That is not what you want.

1. This repo includes **`wrangler.toml`** with **`[assets] directory = "./pages_publish"`** so only the built site ships.
2. **`pages_publish/`** must exist **before** upload — run the publish script on the **build** step (Cloudflare’s environment is Linux, so use the **`.sh`** script):

   ```bash
   bash scripts/build_pages_publish.sh
   ```

3. **Deploy step** (after a successful build):

   ```bash
   npx wrangler versions upload
   ```

   Or one combined **build command**: **`bash scripts/build_pages_publish.sh && npx wrangler versions upload`** (and leave the separate deploy command empty if your dashboard allows that).

4. Edit **`wrangler.toml`** and set **`name`** to match your Worker’s name in the Cloudflare dashboard (replace **`REPLACE_WITH_WORKER_NAME`**).

5. In the Workers / Git integration project → **Settings → Variables** (or build environment), set **`VITE_API_BASE_URL`** for the step that runs the shell script (**`https://api.collinsmediallc.com`**, no trailing slash) so the production bundle hits your tunnel API, not **`www`**-relative **`/api`**.

6. SPA refresh under **`/dashboardtestv1/*`** relies on **`pages_publish/_redirects`**; Workers static assets **[parse **`_redirects`**](https://developers.cloudflare.com/workers/static-assets/redirects/)** like Pages.

---

## Cloudflare — **Pages** (alternative — not **`wrangler upload`**)

If you use **Cloudflare Pages** instead of Workers + Wrangler, follow this path:

1. **Build output** — do **not** point Pages at **`frontend/dist/`** alone; that would miss root **coming soon** and SPA routing. From repo root run either:
   - **`scripts\build_pages_publish.ps1`** (Windows), or
   - **`bash scripts/build_pages_publish.sh`** (macOS / Linux / WSL).

   This creates **`pages_publish/`** (gitignored): root **`index.html`** + **`dashboardtestv1/`** (Vite **`dist`**) + **`_redirects`** so client-side routes work on refresh.

2. **Pages project** — **Build output directory:** **`pages_publish`**. **Build command:** the script above (or equivalent in CI). If Cloudflare runs installs for you, use e.g. **`npm install && npm run build`** inside **`frontend`** plus a step that assembles **`pages_publish`** — easiest is to run the provided script as the full build.

3. **Environment variable (required for production JS bundle)** — in the Pages project → **Settings → Environment variables → Production**, set:

   | Name | Example value |
   |------|----------------|
   | **`VITE_API_BASE_URL`** | **`https://api.collinsmediallc.com`** (no trailing slash) |

   Vite inlines this at **build** time. If you only set it in the dashboard but the build never sees it, the app will call same-origin **`/api/...`** on **`www`** and fail unless you add a Worker proxy.

4. **Custom domain** — keep **`www`** on this Pages project. The app lives at **`https://www.collinsmediallc.com/dashboardtestv1/`**.

5. **Changing the path** — update **`DASHBOARD_BASE`** in **`frontend/vite.config.ts`** and the **`_redirects`** line in **`scripts/build_pages_publish.sh`** / **`.ps1`** together.

## Applying SQL from this repo

```bash
cd /path/to/portfolio_site
pip install -r scripts/requirements.txt   # pymssql + dotenv; use a venv if you prefer
export MASTER_CREDENTIALS_ENV=/path/to/privileged.env   # optional first load
python3 scripts/run_sql_file.py scripts/sql/dashboard_perf_ro/create_vw_dashboard_from_slot_master_revenue.sql
```

## Deploy vs local

- **Cloudflare Workers** — **`pages_publish`** + **`wrangler.toml`** (see **Workers + Wrangler** above); build before **`wrangler versions upload`**.
- **Cloudflare Pages** — same **`pages_publish`** output if you prefer Pages instead of **`wrangler upload`**.
- **API** — runs on your server; **`backend_live`** + tunnel (e.g. **`api.`** subdomain). It is **not** deployed with the static site.
- **Docker (optional)** — from repo root with **`backend_live/.env`** in place: **`docker compose up -d --build`**. Publishes **`127.0.0.1:9001`** so **`cloudflared`** on the host can keep **`http://127.0.0.1:9001`**. See **`backend_live/README.md`**.

## Layout philosophy

- **`backend_local`** / **`backend_live`** — same code shape, different default port and **`.env.example`** (reload on/off).
- **`scripts/`** — operational glue that used to live only in other workspaces; it’s vendored here on purpose.
