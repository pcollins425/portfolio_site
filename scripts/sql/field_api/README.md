# Field / scanner API SQL principal (`dgs_field_api`)

**Purpose:** service account for scan lookup and (later) controlled writes on **`projects.work_orders`**. Separate from **`dashboard_perf_ro`**.

**Apply** (privileged login; replace password placeholder first):

```bash
python3 scripts/run_sql_file.py scripts/sql/field_api/setup_field_api_login.sql --database dgs_application_db
```

**Backend `.env`:** set **`MSSQL_USER=dgs_field_api`** and **`MSSQL_PASSWORD=`** (from vault) on the API host that serves field routes — not necessarily the same `.env` as the revenue dashboard if you split services later.

**Grow access:** append **`GRANT … TO [dgs_field_api]`** batches to **`setup_field_api_login.sql`** (or a new `grant_*.sql`) and re-run.
