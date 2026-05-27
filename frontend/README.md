# Frontend — Master Revenue dashboards

React + Vite + Tailwind + Recharts. Routes: **Executive**, **Analyst**, **Finance**, **Performance**. All data is **`GET /api/...`** via the dev proxy to **`backend_local`** (**`127.0.0.1:9002`**).

```powershell
cd E:\portfolio_site\frontend
npm install
npm run dev
```

Run **`python run.py`** in **`../backend_local`** first (or **`scripts/run-backend-local.cmd`** from repo root).

**Production build:** **`npm run build`** → **`dist/`**. Host that output on Cloudflare Pages (or any static host); the API stays on your server / tunnel.
