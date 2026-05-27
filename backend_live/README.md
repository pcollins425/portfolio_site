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

Point your tunnel at this host/port. **`MSSQL_*`** should use the same read-only façade user as production policy allows.
