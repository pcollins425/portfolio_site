"""Read-only browse + record queries for eMaint demo tables (field SQL profile)."""

from __future__ import annotations

import json
import os
import re
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from uuid import UUID

from app import mssql

_COL_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

_CONFIG_PATH = Path(__file__).resolve().parents[1] / "data" / "emaint_demo_tables.json"


def _catalog() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _bracket(col: str) -> str:
    if not _COL_RE.match(col):
        raise ValueError(f"invalid column name: {col!r}")
    return f"[{col}]"


def _json_val(v):
    if v is None:
        return None
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, UUID):
        return str(v)
    if isinstance(v, bytes):
        return v.decode("utf-8", errors="replace")
    return v


def _row_json(row: dict) -> dict:
    return {k: _json_val(v) for k, v in row.items()}


def _query(sql: str, params=None) -> list[dict]:
    return mssql.query(
        sql,
        params=params,
        database=_catalog(),
        profile="field",
        load_env=False,
    )


def load_table_config() -> dict:
    return json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))


def list_tables() -> list[dict]:
    cfg = load_table_config()
    out = []
    for table_id, spec in cfg.items():
        out.append(
            {
                "id": table_id,
                "title": spec["title"],
                "emaint_table": spec["emaint_table"],
                "sql_object": f"{spec['sql_schema']}.{spec['sql_table']}",
                "key_column": spec["key_column"],
                "browse_columns": spec["browse_columns"],
                "form_fields": spec["form_fields"],
            }
        )
    return out


def _table_spec(table_id: str) -> dict:
    cfg = load_table_config()
    if table_id not in cfg:
        raise KeyError(table_id)
    return cfg[table_id]


def _qualified_table(spec: dict) -> str:
    return f"[{spec['sql_schema']}].[{spec['sql_table']}]"


def browse_rows(table_id: str, *, limit: int = 50, offset: int = 0, q: str | None = None):
    spec = _table_spec(table_id)
    key_col = spec["key_column"]
    cols = list(dict.fromkeys([*spec["browse_columns"], key_col]))
    select_list = ", ".join(_bracket(c) for c in cols)
    sql = f"SELECT {select_list} FROM {_qualified_table(spec)}"
    params: list = []
    if q and q.strip():
        term = f"%{q.strip()}%"
        where_parts = [f"CAST({_bracket(c)} AS nvarchar(max)) LIKE %s" for c in cols]
        sql += " WHERE (" + " OR ".join(where_parts) + ")"
        params.extend([term] * len(cols))
    order_col = _bracket(key_col)
    sql += f" ORDER BY {order_col} DESC OFFSET %s ROWS FETCH NEXT %s ROWS ONLY"
    params.extend([offset, limit])
    rows = [_row_json(r) for r in _query(sql, tuple(params))]
    return {
        "table_id": table_id,
        "rows": rows,
        "limit": limit,
        "offset": offset,
        "key_column": key_col,
    }


def get_row(table_id: str, key: str):
    spec = _table_spec(table_id)
    key_col = spec["key_column"]
    form_cols = list(dict.fromkeys(spec["form_fields"].values()))
    if key_col not in form_cols:
        form_cols.insert(0, key_col)
    select_list = ", ".join(_bracket(c) for c in form_cols)
    sql = f"SELECT {select_list} FROM {_qualified_table(spec)} WHERE {_bracket(key_col)} = %s"
    rows = _query(sql, (key,))
    if not rows:
        return None
    row = _row_json(rows[0])
    labeled = {}
    for label, col in spec["form_fields"].items():
        labeled[label] = row.get(col)
    return {
        "table_id": table_id,
        "key_column": key_col,
        "key": row.get(key_col),
        "fields": labeled,
        "raw": row,
    }


def health_check() -> dict:
    cfg = load_table_config()
    counts = {}
    ok = True
    err = None
    try:
        for table_id, spec in cfg.items():
            sql = f"SELECT COUNT(*) AS n FROM {_qualified_table(spec)}"
            counts[table_id] = int(_query(sql)[0]["n"])
    except Exception as exc:
        ok = False
        err = str(exc)
    return {"ok": ok, "error": err, "row_counts": counts}
