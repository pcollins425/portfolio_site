# Frontend — Master Revenue dashboards

React + Vite + Tailwind + Recharts. Routes: **Executive**, **Analyst**, **Finance**, **Performance**.

- **Dev** — **`npm run dev`** → **`http://localhost:5173/`** (base **`/`**). **`GET /api/...`** is proxied to **`backend_local`** (**`127.0.0.1:9002`**).
- **Production (Cloudflare)** — base path **`/dashboardtestv1/`**. Set **`VITE_API_BASE_URL`** to your tunnel API origin (**no** trailing slash), e.g. **`https://api.collinsmediallc.com`**, then build via repo root **`scripts/build_pages_publish.*`** so **`www`** keeps root **coming soon** and the SPA ships under **`/dashboardtestv1/`**.

```powershell
cd E:\portfolio_site\frontend
npm install
npm run dev
```

Run **`python run.py`** in **`../backend_local`** first (or **`scripts/run-backend-local.cmd`** from repo root).

**Production API URL:** copy **`.env.production.example`** → **`.env.production`** for local production builds, or set **`VITE_API_BASE_URL`** in Cloudflare Pages before the build step.

**Do not** run **`npm run build`** alone for **`www`** unless you only need to inspect **`dist/`**; use **`scripts/build_pages_publish.ps1`** / **`.sh`** for the combined Pages output.
