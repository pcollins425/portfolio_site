"""Browse + record queries for eMaint demo tables (field SQL profile).

Inventory curated table supports PATCH on ``attributes`` JSON only.
"""

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
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)

_CONFIG_PATH = Path(__file__).resolve().parents[1] / "data" / "emaint_demo_tables.json"
_PREP_STATUS_PATH = Path(__file__).resolve().parents[1] / "data" / "emaint_asset_prep_statuses.json"


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


def _execute(sql: str, params=None) -> None:
    mssql.execute(
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
        entry = {
            "id": table_id,
            "title": spec["title"],
            "emaint_table": spec["emaint_table"],
            "sql_object": f"{spec['sql_schema']}.{spec['sql_table']}",
            "key_column": spec["key_column"],
            "browse_columns": spec["browse_columns"],
            "form_fields": spec["form_fields"],
            "editable_columns": spec.get("editable_columns") or [],
            "json_columns": spec.get("json_columns") or [],
        }
        if spec.get("alternate_key_column"):
            entry["alternate_key_column"] = spec["alternate_key_column"]
        if spec.get("detail_children"):
            entry["detail_children"] = spec["detail_children"]
        out.append(entry)
    return out


def _table_spec(table_id: str) -> dict:
    cfg = load_table_config()
    if table_id not in cfg:
        raise KeyError(table_id)
    spec = dict(cfg[table_id])
    spec["_table_id"] = table_id
    return spec


def _qualified_table(spec: dict) -> str:
    return f"[{spec['sql_schema']}].[{spec['sql_table']}]"


def _lookup_column(spec: dict, key: str) -> tuple[str, str]:
    """Single-column lookup (work orders: WO number vs uuid)."""
    key_col = spec["key_column"]
    alt = spec.get("alternate_key_column")
    if alt and not _UUID_RE.match(key):
        return alt, key
    return key_col, key


def _where_for_key(spec: dict, key: str) -> tuple[str, tuple]:
    """WHERE clause + params for row fetch/update by primary or alternate key."""
    key_col = spec["key_column"]
    alt = spec.get("alternate_key_column")
    table_id = spec.get("_table_id")
    if alt and table_id == "work_orders":
        lookup_col, lookup_key = _lookup_column(spec, key)
        return f"{_bracket(lookup_col)} = %s", (lookup_key,)
    if alt:
        return (
            f"({_bracket(key_col)} = %s OR {_bracket(alt)} = %s)",
            (key, key),
        )
    return f"{_bracket(key_col)} = %s", (key,)


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
    order_col = _bracket(spec.get("order_column") or key_col)
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


def _parse_attributes_json(raw: str | None) -> dict | list | None:
    if raw is None or raw == "":
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"_parse_error": True, "_raw": raw}


def _flatten_attributes(obj, prefix: str = "") -> list[tuple[str, str]]:
    if obj is None:
        return []
    if isinstance(obj, dict) and obj.get("_parse_error"):
        return [("attributes (invalid JSON)", str(obj.get("_raw", ""))[:500])]
    lines: list[tuple[str, str]] = []

    def walk(o, path: str) -> None:
        if isinstance(o, dict):
            for k, v in o.items():
                if k.startswith("_"):
                    continue
                p = f"{path}.{k}" if path else k
                walk(v, p)
        elif isinstance(o, list):
            lines.append((path, ", ".join(str(x) for x in o[:20])))
        else:
            lines.append((path, str(o)))

    walk(obj, prefix)
    return lines


def get_row(table_id: str, key: str):
    spec = _table_spec(table_id)
    key_col = spec["key_column"]
    where_sql, where_params = _where_for_key(spec, key)
    json_cols = list(spec.get("json_columns") or [])
    form_cols = list(dict.fromkeys([*spec["form_fields"].values(), *json_cols]))
    if key_col not in form_cols:
        form_cols.insert(0, key_col)
    alt = spec.get("alternate_key_column")
    if alt and alt not in form_cols:
        form_cols.append(alt)
    select_list = ", ".join(_bracket(c) for c in form_cols)
    sql = f"SELECT {select_list} FROM {_qualified_table(spec)} WHERE {where_sql}"
    rows = _query(sql, where_params)
    if not rows:
        return None
    row = _row_json(rows[0])
    labeled = {}
    for label, col in spec["form_fields"].items():
        labeled[label] = row.get(col)
    for col in json_cols:
        parsed = _parse_attributes_json(row.get(col))
        labeled[f"— {col} (summary) —"] = None
        for path, val in _flatten_attributes(parsed):
            labeled[f"  {path}"] = val
        labeled[f"— {col} (JSON) —"] = row.get(col)
    return {
        "table_id": table_id,
        "key_column": key_col,
        "key": row.get(key_col),
        "fields": labeled,
        "raw": row,
        "editable_columns": list(spec.get("editable_columns") or []),
        "json_columns": json_cols,
    }


def patch_row(table_id: str, key: str, updates: dict) -> dict:
    spec = _table_spec(table_id)
    allowed = set(spec.get("editable_columns") or [])
    if not allowed:
        raise ValueError(f"Table {table_id} has no editable columns")
    if not updates:
        raise ValueError("No fields to update")

    unknown = set(updates) - allowed
    if unknown:
        raise ValueError(f"Columns not editable: {', '.join(sorted(unknown))}")

    where_sql, where_params = _where_for_key(spec, key)
    sets = []
    params: list = []
    for col, val in updates.items():
        if col in (spec.get("json_columns") or []):
            if val is None:
                text = None
            elif isinstance(val, str):
                text = val
                try:
                    json.loads(text)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"{col} must be valid JSON") from exc
            else:
                text = json.dumps(val, ensure_ascii=False)
        else:
            text = val
        sets.append(f"{_bracket(col)} = %s")
        params.append(text)

    sql = f"UPDATE {_qualified_table(spec)} SET {', '.join(sets)} WHERE {where_sql}"
    params.extend(list(where_params))
    _execute(sql, tuple(params))
    row = get_row(table_id, key)
    if row is None:
        raise ValueError("Row not found after update")
    return row


def browse_child_rows(table_id: str, key: str, child_id: str) -> dict | None:
    spec = _table_spec(table_id)
    children = spec.get("detail_children") or {}
    if child_id not in children:
        raise KeyError(child_id)
    child = children[child_id]

    where_sql, where_params = _where_for_key(spec, key)
    parent_sql = (
        f"SELECT {_bracket(spec['key_column'])} AS parent_key "
        f"FROM {_qualified_table(spec)} WHERE {where_sql}"
    )
    parent_rows = _query(parent_sql, where_params)
    if not parent_rows:
        return None

    parent_key = parent_rows[0]["parent_key"]
    if parent_key is None or str(parent_key).strip() == "":
        return {
            "table_id": table_id,
            "child_id": child_id,
            "parent_key": key,
            "rows": [],
            "browse_columns": child["browse_columns"],
        }

    fk = child["parent_fk_column"]
    cols = list(dict.fromkeys([*child["browse_columns"], fk]))
    select_list = ", ".join(_bracket(c) for c in cols)
    child_table = f"[{child['sql_schema']}].[{child['sql_table']}]"
    order_col = _bracket(child.get("order_column") or child["browse_columns"][0])
    sql = (
        f"SELECT {select_list} FROM {child_table} "
        f"WHERE {_bracket(fk)} = %s ORDER BY {order_col} ASC"
    )
    rows = [_row_json(r) for r in _query(sql, (parent_key,))]
    return {
        "table_id": table_id,
        "child_id": child_id,
        "title": child.get("title") or child_id,
        "parent_key": str(parent_key),
        "rows": rows,
        "browse_columns": child["browse_columns"],
    }


def _load_prep_status_config() -> dict:
    return json.loads(_PREP_STATUS_PATH.read_text(encoding="utf-8"))


def list_compinfo_prep_statuses() -> dict:
    cfg = _load_prep_status_config()
    return {
        "field": cfg.get("field", "status"),
        "values": cfg.get("values") or [],
    }


def _allowed_prep_statuses() -> set[str]:
    return {v["status"] for v in _load_prep_status_config().get("values") or []}


def resolve_compinfo(token: str) -> dict | None:
    q = (token or "").strip()
    if not q:
        raise ValueError("token is required")
    spec = _table_spec("compinfo")
    table = _qualified_table(spec)
    sql = (
        f"SELECT TOP 1 compid, serial_no, asset_id, property, status, comp_desc, manufac, model_no "
        f"FROM {table} "
        f"WHERE compid = %s OR serial_no = %s OR asset_id = %s"
    )
    rows = _query(sql, (q, q, q))
    if not rows:
        return None
    return _row_json(rows[0])


def set_compinfo_prep_status(*, compid: str, status: str) -> dict:
    cid = (compid or "").strip()
    st = (status or "").strip()
    if not cid:
        raise ValueError("compid is required")
    if not st:
        raise ValueError("status is required")
    allowed = _allowed_prep_statuses()
    if st not in allowed:
        raise ValueError(f"status must be one of: {', '.join(sorted(allowed))}")

    from app import emaint_client

    emaint_client.record_update(table="COMPINFO", row_id=cid, payload={"status": st})

    spec = _table_spec("compinfo")
    sql = f"UPDATE {_qualified_table(spec)} SET {_bracket('status')} = %s WHERE {_bracket('compid')} = %s"
    n = _execute(sql, (st, cid))
    if n != 1:
        raise ValueError(f"Landing update affected {n} row(s); expected 1")

    row = resolve_compinfo(cid)
    if row is None:
        raise ValueError("Asset not found after update")
    return {
        "ok": True,
        "compid": cid,
        "status": st,
        "asset": row,
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
