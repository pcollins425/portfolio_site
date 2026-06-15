# Field / scanner API SQL principal (`dgs_field_api`)

**Purpose:** service account for scan lookup and (later) controlled writes on **`projects.work_orders`**. Separate from **`dashboard_perf_ro`**.

**Apply** (privileged login; replace password placeholder first):

```bash
python3 scripts/run_sql_file.py scripts/sql/field_api/setup_field_api_login.sql --database dgs_application_db
```

**Backend `.env`:** set **`MSSQL_USER=dgs_field_api`** and **`MSSQL_PASSWORD=`** (from vault) on the API host that serves field routes — not necessarily the same `.env` as the revenue dashboard if you split services later.

**Grow access:** append **`GRANT … TO [dgs_field_api]`** batches to **`setup_field_api_login.sql`** (or a new `grant_*.sql`) and re-run.

**Purchase orders (2026-05-29):** after creating **`inventory.purchase_order`** / **`purchase_order_line`**, run:

```bash
python3 scripts/run_sql_file.py scripts/sql/field_api/grant_purchase_order_field_api.sql --database dgs_application_db
python3 scripts/run_sql_file.py scripts/sql/field_api/grant_contract_field_api.sql --database dgs_application_db
```

(No password/login change — same **`dgs_field_api`** principal; only object permissions were missing.)

**Slot Master (2026-06-09):** after **`inventory.slot_master_migration`** exists:

```bash
python3 scripts/run_sql_file.py scripts/sql/field_api/grant_slot_master_field_api.sql --database dgs_application_db
python3 scripts/run_sql_file.py scripts/sql/seed_slot_master_permissions.sql --database dgs_application_db
```

Re-login after the permission seed so JWT includes **`slot_master:UPDATES_ONLY`**.

**Expenses (2026-06-15):** browse UI reads **`finance.expenses`** via field API credentials (`dgs_field_api` in prod; `dashboard_perf_ro` when **`MSSQL_FIELD_*`** is unset locally):

```bash
python3 scripts/run_sql_file.py scripts/sql/field_api/grant_expenses_field_api.sql --database dgs_application_db
```

Use a **privileged** login (`paulc` / **`MASTER_CREDENTIALS_ENV`**) — not `dashboard_perf_ro`. Grants **`SELECT`** on **`finance.expenses`**, **`finance.card_accounts`**, **`finance.expense_account_gl_display`**, and **`employees.employee_roles`** to whichever of **`dgs_field_api`** / **`dashboard_perf_ro`** exists.

**Operations read-only — executives (2026-06-12):** Haley H, Garrett A, Travis J — run with **privileged** login (`paulc`, not `dashboard_perf_ro`):

```bash
python3 scripts/run_sql_file.py scripts/sql/seed_dgs_ops_readonly_executives.sql --database dgs_application_db
```

Or apply from `cursor_assistant` with master `.env`. Re-login after apply.
