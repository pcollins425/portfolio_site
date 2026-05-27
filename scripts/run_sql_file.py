#!/usr/bin/env python3
"""Run a T-SQL script on MSSQL (batches split on ``GO`` lines).

Loads credentials into this **order** — last file wins where keys overlap:

1. Env var **``MASTER_CREDENTIALS_ENV``** → path to a ``.env`` (optional bundle).
2. **``portfolio_site/.env``** if present (repo root next to ``scripts/``).
3. **``portfolio_site/backend_local/.env``** if present.

Use a **privileged** login for DDL scripts (view + grants). Dashboard API reads can use ``dashboard_perf_ro``
in ``backend_*`` `.env`; do **not** use that principal to create views unless it is elevated.

Host uses **``MSSQL_EXTERNAL``** or **``MSSQL_HOST``** or **``MSSQL_SERVER``** (compat with older notes).

Requirements: ``pip install -r scripts/requirements.txt``

Example::

    cd /path/to/portfolio_site
    export MASTER_CREDENTIALS_ENV=/path/to/admin.env
    python3 scripts/run_sql_file.py scripts/sql/dashboard_perf_ro/create_vw_dashboard_from_slot_master_revenue.sql
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv

import pymssql

_REPO = Path(__file__).resolve().parent.parent


def _load_credentials() -> None:
    mc = os.environ.get("MASTER_CREDENTIALS_ENV", "").strip()
    if mc:
        p = Path(mc).expanduser()
        if p.is_file():
            load_dotenv(p, override=False)
    for cand in (_REPO / ".env", _REPO / "backend_local" / ".env"):
        if cand.is_file():
            load_dotenv(cand, override=True)


def _connect(database_override: str | None = None):
    _load_credentials()
    host = (
        os.environ.get("MSSQL_EXTERNAL")
        or os.environ.get("MSSQL_HOST")
        or os.environ.get("MSSQL_SERVER")
        or ""
    ).strip()
    user = (os.environ.get("MSSQL_USER") or "").strip()
    password = os.environ.get("MSSQL_PASSWORD") or ""
    database = (database_override or os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()
    port = (os.environ.get("MSSQL_PORT") or "1433").strip()
    if not host or not user:
        sys.stderr.write("Missing MSSQL host (MSSQL_EXTERNAL / MSSQL_HOST / MSSQL_SERVER) or MSSQL_USER\n")
        sys.exit(2)
    conn = pymssql.connect(server=host, user=user, password=password, database=database, port=port)
    print(f"Connected: MSSQL_DATABASE={database} @{host}")
    return conn


def main() -> None:
    p = argparse.ArgumentParser(description="Apply a .sql file (GO-split batches)")
    p.add_argument("sql_file", type=Path)
    p.add_argument("--database", metavar="NAME", help="Override MSSQL_DATABASE")
    p.add_argument(
        "--dry-run",
        action="store_true",
        help="Print batch count only",
    )
    args = p.parse_args()
    path = args.sql_file if args.sql_file.is_absolute() else _REPO / args.sql_file
    if not path.is_file():
        sys.stderr.write(f"Not found: {path}\n")
        sys.exit(1)

    raw = path.read_text(encoding="utf-8", errors="replace")
    batches = [b.strip() for b in re.split(r"(?im)^\s*GO\s*$", raw) if b.strip()]
    if args.dry_run:
        print(f"batches={len(batches)}")
        for i, batch in enumerate(batches):
            print(f"  [{i + 1}] {len(batch)} chars")
        return

    conn = _connect(database_override=args.database)
    try:
        cur = conn.cursor()
        for i, batch in enumerate(batches, start=1):
            cur.execute(batch)
            conn.commit()
            print(f"  Batch {i}/{len(batches)} committed")
        print(f"OK: applied {len(batches)} batch(es) from {path.name}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
