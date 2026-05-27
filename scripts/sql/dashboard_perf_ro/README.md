# Dashboard read-only SQL principal (`dashboard_perf_ro`)

All of this lives in **`portfolio_site`** — no other repo.

**Purpose:** one **SQL Authentication** login that can **only** `SELECT` from **`dashboard.vw_performance_report`**. Used by **`backend_local`** / **`backend_live`** (`.env`); **not** a human SSO identity.

## View: `dashboard.vw_performance_report`

**`create_vw_dashboard_from_slot_master_revenue.sql`** builds (or replaces) **`dashboard.vw_performance_report`** in the catalog set by **`MSSQL_DATABASE`** in your env (typically **`dgs_application_db`**), as:

`SELECT * FROM [DGS_SLOT].[dbo].[Master_Revenue]` (table **`Master_Revenue`**, not `Master_Revenu`).

Apply with the **`portfolio_site`** script runner (privileged credentials in env):

```bash
cd /path/to/portfolio_site
python3 -m venv scripts/.venv   # optional
scripts/.venv/bin/pip install -r scripts/requirements.txt
export MASTER_CREDENTIALS_ENV=/path/to/admin.env   # or use portfolio_site/.env
python3 scripts/run_sql_file.py scripts/sql/dashboard_perf_ro/create_vw_dashboard_from_slot_master_revenue.sql
```

**``run_sql_file.py``** respects **`MASTER_CREDENTIALS_ENV`**, then **`portfolio_site/.env`**, then **`backend_local/.env`**. Override catalog with **`--database`**.

Windows (PowerShell), from repo root:

```powershell
$env:MASTER_CREDENTIALS_ENV = "X:\secure\admin.env"
py -3 scripts\run_sql_file.py scripts/sql/dashboard_perf_ro/create_vw_dashboard_from_slot_master_revenue.sql
```

### Mounting credentials USB in WSL (optional)

Your machine may expose a **`G:`** drive with **`master_credentials/.env`**—mount it (`drvfs`), then **`export MASTER_CREDENTIALS_ENV=/mnt/g/master_credentials/.env`** before running DDL.

## Apply reader + façade (alternate path)

**`setup_dashboard_perf_reader.sql`** — replace placeholders (**never commit passwords**):

- `__REPLACE_UNDERLYING_OBJECT__` → source object when not using **`create_vw_*.sql`**
- `__REPLACE_DASHBOARD_SQL_PASSWORD__` → **`dashboard_perf_ro`** password

```bash
python3 scripts/run_sql_file.py scripts/sql/dashboard_perf_ro/setup_dashboard_perf_reader.sql --database dgs_application_db
```

**Security template (copy, edit offline):**

- **`create_dashboard_perf_login_user_TEMPLATE.sql`** — creates **`dashboard_perf_ro`** + **`GRANT SELECT`** on the view.

**Cross-database:** apply **`grant_dashboard_perf_ro_dgs_slot_master_revenue.sql`** so **`dashboard_perf_ro`** can **`SELECT`** **`[DGS_SLOT].[dbo].[Master_Revenue]`** through the view.

## Verify (SSMS or `sqlcmd`)

Sign in **as `dashboard_perf_ro`** (same server, **`dgs_application_db`**):

```sql
SELECT TOP 10 * FROM dashboard.vw_performance_report;
```

## Connection shape (API `.env`)

Username **`dashboard_perf_ro`**, password from your secret store, database as above; align TLS with your **`pymssql`** policy.
