"""Field / scanner lookups from inventory.compinfo_landing (dgs_field_api)."""

from __future__ import annotations

import os
from datetime import date, datetime

from fastapi import APIRouter, HTTPException, Query

from app import mssql

router = APIRouter(prefix="/api", tags=["field"])

_LOOKUP_SQL = """
SELECT TOP 1
    compid,
    serial_no,
    comp_desc,
    manufac,
    model_no,
    property,
    state,
    tribe,
    zone,
    bank,
    location,
    asset_id,
    casino_id,
    _synced_at
FROM inventory.compinfo_landing
WHERE serial_no = %s
"""


def _catalog() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _field_query(sql: str, params=None):
    return mssql.query(
        sql,
        params=params,
        database=_catalog(),
        profile="field",
        load_env=False,
    )


def _json_value(v):
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return v


def _row_to_asset(row: dict) -> dict:
    return {k: _json_value(v) for k, v in row.items()}


@router.get("/field/health")
def field_health():
    """Verify field SQL login can read compinfo_landing."""
    catalog = _catalog()
    ok = False
    n = None
    try:
        row = _field_query("SELECT COUNT(*) AS n FROM inventory.compinfo_landing")[0]
        n = int(row["n"])
        ok = True
    except Exception:
        pass
    ext = os.environ.get("MSSQL_EXTERNAL") or os.environ.get("MSSQL_HOST")
    return {
        "ok": ok,
        "database": catalog,
        "table": "inventory.compinfo_landing",
        "host": ext,
        "compinfo_rows": n,
    }


@router.get("/asset/lookup")
def asset_lookup_by_serial(
    serial: str = Query(..., min_length=1, max_length=64, description="Cabinet serial number"),
):
    token = serial.strip()
    if not token:
        raise HTTPException(status_code=400, detail="serial is required")

    try:
        rows = _field_query(_LOOKUP_SQL, (token,))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    if not rows:
        raise HTTPException(status_code=404, detail=f"no asset for serial {token!r}")

    return {
        "found": True,
        "matched_on": "serial_no",
        "serial": token,
        "asset": _row_to_asset(rows[0]),
    }
