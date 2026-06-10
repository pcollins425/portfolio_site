# `scripts/` — operations

| File | Role |
|------|------|
| **`run_sql_file.py`** | Apply **`.sql`** files (split on **`GO`**). Loads **`MASTER_CREDENTIALS_ENV`** → **`../.env`** → **`../backend_local/.env`**. **`pip install -r scripts/requirements.txt`**. |
| **`run-backend-local.sh` / `.cmd`** | **`cd ../backend_local && python run.py`** |
| **`run-backend-live.sh` / `.cmd`** | **`cd ../backend_live && python run.py`** |
| **`deploy-backend-docker.sh`** | **`git pull`** + **`docker compose down`** + **`docker compose up -d --build`** + health check (from repo root). |
| **`check-backend-updates.sh`** | Poll **`origin/main`**; redeploy when **`backend_live/`** or **`docker-compose.yml`** change (cron-friendly). |
| **`github-webhook-listener.py`** | GitHub **push** webhook → instant deploy (bind loopback; expose via **cloudflared** or nginx/Caddy). |
| **`sql/dashboard_perf_ro/`** | View **`dashboard.vw_performance_report`**, **`dashboard_perf_ro`** grants — see **`sql/dashboard_perf_ro/README.md`**. |

## Auto-redeploy **`backend_live`** (Docker host)

Your API container is built from this repo on the server — it is **not** redeployed when Cloudflare Workers/Pages updates the static site. Use one of these on the machine that runs **`docker compose`**:

### 1. Manual / one-shot

```bash
cd /path/to/portfolio_site
bash scripts/deploy-backend-docker.sh
```

### 2. Poll for git changes (no inbound port)

```bash
# every 5 minutes
*/5 * * * * cd /path/to/portfolio_site && bash scripts/check-backend-updates.sh >> /var/log/portfolio-backend-deploy.log 2>&1
```

### 3. GitHub webhook (immediate on push)

1. On the server: `export GITHUB_WEBHOOK_SECRET='…'` (long random string).
2. Run the listener (systemd example):

   ```ini
   [Service]
   WorkingDirectory=/path/to/portfolio_site
   Environment=GITHUB_WEBHOOK_SECRET=…
   ExecStart=/usr/bin/python3 scripts/github-webhook-listener.py --host 127.0.0.1 --port 9009
   Restart=always
   ```

3. Expose the listener — **Cloudflare Tunnel** (same host as **`cloudflared`**) is enough; no extra public port or reverse proxy required. Add an ingress rule **above** the catch-all API rule (order matters):

   ```yaml
   # ~/.cloudflared/config.yml (or Cloudflare Zero Trust → Tunnels → Public Hostname)
   ingress:
     - hostname: api.collinsmediallc.com
       path: /hooks/portfolio-backend
       service: http://127.0.0.1:9009
     - hostname: api.collinsmediallc.com
       service: http://127.0.0.1:9001
     - service: http_status:404
   ```

   Or use a separate hostname on the **same tunnel**, e.g. **`deploy.collinsmediallc.com`** → **`http://127.0.0.1:9009`**.

4. In GitHub → **Settings → Webhooks**: Payload URL e.g. `https://api.collinsmediallc.com/hooks/portfolio-backend`, content type **application/json**, secret = same as **`GITHUB_WEBHOOK_SECRET`**, events = **Just the push event**.

Only pushes to **`main`** that touch **`backend_live/`** or **`docker-compose.yml`** trigger a rebuild. Override with **`DEPLOY_BRANCH`** / **`BACKEND_DEPLOY_PATHS`**.

**Why a second local port?** The listener stays off the public API process. During deploy, **`docker compose down`** briefly stops **`:9001`**; **`:9009`** keeps running so GitHub still gets **`202`** and the redeploy can finish.
