"""Warehouse inventory read API — COMPINFO landing rows at warehouse properties."""

from __future__ import annotations

import math
import os
from datetime import date, datetime

from fastapi import APIRouter, HTTPException, Query

from app import mssql

router = APIRouter(prefix="/api/warehouse-inventory", tags=["warehouse-inventory"])

_WHERE_WAREHOUSE = """
    LOWER(LTRIM(RTRIM(ISNULL(property, N'')))) LIKE N'%warehouse%'
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
        return v.date().isoformat() if v else None
    if isinstance(v, date):
        return v.isoformat()
    if v is None:
        return None
    return str(v).strip() if isinstance(v, str) else v


def _date_received(row: dict) -> str | None:
    for key in ("purch_date", "adddate"):
        val = _json_value(row.get(key))
        if val:
            return val
    return None


@router.get("/health")
def warehouse_inventory_health():
    catalog = _catalog()
    ok = False
    n = None
    try:
        row = _field_query(
            f"""
            SELECT COUNT(*) AS n
            FROM inventory.compinfo_landing
            WHERE {_WHERE_WAREHOUSE}
            """
        )[0]
        n = int(row["n"])
        ok = True
    except Exception:
        pass
    ext = os.environ.get("MSSQL_EXTERNAL") or os.environ.get("MSSQL_HOST")
    return {
        "ok": ok,
        "database": catalog,
        "warehouse_rows": n,
        "host": ext,
    }


@router.get("/summary")
def warehouse_summary():
    """Total assets per warehouse property (compinfo_landing)."""
    try:
        rows = _field_query(
            f"""
            SELECT LTRIM(RTRIM(property)) AS property, COUNT(*) AS total
            FROM inventory.compinfo_landing
            WHERE {_WHERE_WAREHOUSE}
            GROUP BY LTRIM(RTRIM(property))
            ORDER BY COUNT(*) DESC, LTRIM(RTRIM(property))
            """
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    warehouses = [{"property": r["property"], "total": int(r["total"])} for r in rows]
    return {
        "warehouses": warehouses,
        "grand_total": sum(w["total"] for w in warehouses),
    }


@router.get("/warehouse")
def warehouse_detail(
    property: str = Query(..., min_length=1, max_length=120, description="Warehouse property name"),
    q: str = Query("", max_length=120, description="Search serial, manufacturer, cabinet, prev location"),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
):
    """Cabinet breakdown + paginated asset list for one warehouse."""
    prop = property.strip()
    if not prop:
        raise HTTPException(status_code=400, detail="property is required")

    search = q.strip()
    like = f"%{search}%" if search else None

    filter_sql = f"""
        LTRIM(RTRIM(property)) = %s
        AND {_WHERE_WAREHOUSE}
    """
    search_sql = ""
    search_params: tuple = ()
    if like:
        search_sql = """
            AND (
                serial_no LIKE %s
                OR manufac LIKE %s
                OR model_no LIKE %s
                OR prev_loca LIKE %s
            )
        """
        search_params = (like, like, like, like)

    try:
        exists = _field_query(
            f"""
            SELECT COUNT(*) AS n
            FROM inventory.compinfo_landing
            WHERE {filter_sql}
            """,
            (prop,),
        )[0]
        if int(exists["n"]) == 0:
            raise HTTPException(status_code=404, detail=f"warehouse not found: {prop!r}")

        cabinet_rows = _field_query(
            f"""
            SELECT
                LTRIM(RTRIM(ISNULL(manufac, N''))) AS manufac,
                LTRIM(RTRIM(ISNULL(model_no, N''))) AS model_no,
                COUNT(*) AS total
            FROM inventory.compinfo_landing
            WHERE {filter_sql}
            {search_sql}
            GROUP BY LTRIM(RTRIM(ISNULL(manufac, N''))), LTRIM(RTRIM(ISNULL(model_no, N'')))
            ORDER BY COUNT(*) DESC, model_no, manufac
            """,
            (prop,) + search_params,
        )

        count_row = _field_query(
            f"""
            SELECT COUNT(*) AS n
            FROM inventory.compinfo_landing
            WHERE {filter_sql}
            {search_sql}
            """,
            (prop,) + search_params,
        )[0]
        total_items = int(count_row["n"])

        offset = (page - 1) * page_size
        item_rows = _field_query(
            f"""
            SELECT
                serial_no,
                manufac,
                model_no,
                prev_loca,
                purch_date,
                adddate
            FROM inventory.compinfo_landing
            WHERE {filter_sql}
            {search_sql}
            ORDER BY model_no, manufac, serial_no
            OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY
            """,
            (prop,) + search_params,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    cabinet_counts = [
        {
            "manufacturer": r["manufac"] or None,
            "cabinet": r["model_no"] or None,
            "count": int(r["total"]),
        }
        for r in cabinet_rows
    ]

    items = [
        {
            "serial": _json_value(r.get("serial_no")),
            "manufacturer": _json_value(r.get("manufac")),
            "cabinet": _json_value(r.get("model_no")),
            "date_received": _date_received(r),
            "previous_location": _json_value(r.get("prev_loca")) or None,
        }
        for r in item_rows
    ]

    total_pages = max(1, math.ceil(total_items / page_size)) if total_items else 1

    return {
        "property": prop,
        "search": search or None,
        "total_assets": total_items,
        "distinct_cabinets": len(cabinet_counts),
        "cabinet_counts": cabinet_counts,
        "items": items,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }
