"""Parts inventory browse API — inventory.inventory catalog + stock_balance."""

from __future__ import annotations

import json
import math
import os
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query

from app import mssql

router = APIRouter(prefix="/api/parts-inventory", tags=["parts-inventory"])

EMAINT_ARINVT01_URL = "https://x43.emaint.com/wc.dll?X3~emproc~x3Hubv2#/ARINVT01/{item}"

_INVENTORY_FROM = """
    FROM inventory.inventory AS i
    LEFT JOIN inventory.software AS sw ON sw.item = i.item
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
    if isinstance(v, Decimal):
        return float(v)
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    return str(v).strip() if isinstance(v, str) else v


def _parse_json_col(raw):
    if raw is None or raw == "":
        return None
    if isinstance(raw, (list, dict)):
        return raw
    try:
        return json.loads(str(raw))
    except json.JSONDecodeError:
        return raw


def _inventory_row(r: dict) -> dict:
    return {
        "reference_key": _json_value(r.get("reference_key")),
        "item": _json_value(r.get("item")),
        "item_family": _json_value(r.get("item_family")),
        "item_subcategory": _json_value(r.get("item_subcategory")),
        "emaint_category": _json_value(r.get("emaint_category")),
        "descrip": _json_value(r.get("descrip")),
        "mfr": _json_value(r.get("mfr")),
        "mfrpartno": _json_value(r.get("mfrpartno")),
        "vpartno": _json_value(r.get("vpartno")),
        "onhand": _json_value(r.get("onhand")),
        "location": _json_value(r.get("location")),
        "state": _json_value(r.get("state")),
        "cost": _json_value(r.get("cost")),
        "supplier": _json_value(r.get("supplier")),
        "stock": _json_value(r.get("stock")),
        "in_software_vault": bool(r.get("in_software_vault")),
        "stock_balance_rows": int(r.get("stock_balance_rows") or 0),
        "qty_available": _json_value(r.get("qty_available")),
    }


def _software_filter_sql(exclude_software: bool) -> str:
    if exclude_software:
        return " AND sw.item IS NULL"
    return ""


@router.get("/summary")
def parts_summary(exclude_software: bool = Query(True)):
    """Stat cards for parts browse."""
    sw_sql = _software_filter_sql(exclude_software)
    try:
        row = _field_query(
            f"""
            SELECT
                COUNT(*) AS total_parts,
                COUNT(DISTINCT NULLIF(LTRIM(RTRIM(i.item_family)), N'')) AS families,
                SUM(CASE WHEN i.onhand IS NOT NULL AND i.onhand > 0 THEN 1 ELSE 0 END) AS with_onhand,
                (
                    SELECT COUNT(DISTINCT sb.item)
                    FROM inventory.stock_balance AS sb
                    INNER JOIN inventory.inventory AS ix ON ix.item = sb.item
                    LEFT JOIN inventory.software AS swx ON swx.item = ix.item
                    WHERE sb.qty > 0
                      {"AND swx.item IS NULL" if exclude_software else ""}
                ) AS items_with_balance
            {_INVENTORY_FROM}
            WHERE i.item IS NOT NULL
              AND LTRIM(RTRIM(i.item)) <> N''
              {sw_sql}
            """
        )[0]
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    return {
        "total_parts": int(row["total_parts"]),
        "families": int(row["families"] or 0),
        "with_onhand": int(row["with_onhand"] or 0),
        "items_with_balance": int(row["items_with_balance"] or 0),
        "exclude_software": exclude_software,
    }


@router.get("/families")
def list_families(exclude_software: bool = Query(True)):
    """Distinct item_family values for toolbar filter."""
    sw_sql = _software_filter_sql(exclude_software)
    try:
        rows = _field_query(
            f"""
            SELECT
                NULLIF(LTRIM(RTRIM(i.item_family)), N'') AS item_family,
                COUNT(*) AS n
            {_INVENTORY_FROM}
            WHERE i.item IS NOT NULL
              AND LTRIM(RTRIM(i.item)) <> N''
              {sw_sql}
            GROUP BY i.item_family
            ORDER BY COUNT(*) DESC, i.item_family ASC
            """
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    return {
        "families": [
            {
                "item_family": _json_value(r.get("item_family")) or "—",
                "count": int(r.get("n") or 0),
            }
            for r in rows
        ]
    }


@router.get("")
def list_parts(
    q: str = Query("", max_length=120, description="Search item, description, reference key, mfr part no."),
    family: str = Query("", max_length=40, description="Filter by item_family"),
    exclude_software: bool = Query(True),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """Paginated parts catalog browse."""
    search = q.strip()
    like = f"%{search}%" if search else None
    family_val = family.strip()

    filters_sql = _software_filter_sql(exclude_software)
    filter_params: list = []

    if family_val:
        filters_sql += " AND i.item_family = %s"
        filter_params.append(family_val)

    search_sql = ""
    search_params: tuple = ()
    if like:
        search_sql = """
            AND (
                i.item LIKE %s
                OR i.descrip LIKE %s
                OR i.reference_key LIKE %s
                OR i.mfr LIKE %s
                OR i.mfrpartno LIKE %s
                OR i.vpartno LIKE %s
                OR i.location LIKE %s
            )
        """
        search_params = (like,) * 7

    try:
        count_row = _field_query(
            f"""
            SELECT COUNT(*) AS n
            {_INVENTORY_FROM}
            WHERE i.item IS NOT NULL
              AND LTRIM(RTRIM(i.item)) <> N''
              {filters_sql}
              {search_sql}
            """,
            tuple(filter_params) + search_params,
        )[0]
        total = int(count_row["n"])

        offset = (page - 1) * page_size
        rows = _field_query(
            f"""
            SELECT
                i.reference_key,
                i.item,
                i.item_family,
                i.item_subcategory,
                i.emaint_category,
                i.descrip,
                i.mfr,
                i.mfrpartno,
                i.vpartno,
                i.onhand,
                i.location,
                i.state,
                i.cost,
                i.supplier,
                i.stock,
                CASE WHEN sw.item IS NOT NULL THEN 1 ELSE 0 END AS in_software_vault,
                (
                    SELECT COUNT(*)
                    FROM inventory.stock_balance AS sb
                    WHERE sb.item = i.item AND sb.qty > 0
                ) AS stock_balance_rows,
                (
                    SELECT COALESCE(SUM(sb.qty), 0)
                    FROM inventory.stock_balance AS sb
                    WHERE sb.item = i.item
                      AND sb.bucket = N'WAREHOUSE'
                      AND sb.condition = N'AVAILABLE'
                ) AS qty_available
            {_INVENTORY_FROM}
            WHERE i.item IS NOT NULL
              AND LTRIM(RTRIM(i.item)) <> N''
              {filters_sql}
              {search_sql}
            ORDER BY i.item ASC
            OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY
            """,
            tuple(filter_params) + search_params,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    total_pages = max(1, math.ceil(total / page_size)) if total else 1

    return {
        "items": [_inventory_row(r) for r in rows],
        "search": search or None,
        "family": family_val or None,
        "exclude_software": exclude_software,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
    }


@router.get("/items/{item}")
def get_part(item: str, exclude_software: bool = Query(False)):
    """Part detail with stock balances."""
    item_key = item.strip()
    if not item_key:
        raise HTTPException(status_code=400, detail="item is required")

    sw_sql = _software_filter_sql(exclude_software)

    try:
        rows = _field_query(
            f"""
            SELECT
                i.reference_key,
                i.item,
                i.item_family,
                i.item_subcategory,
                i.emaint_category,
                i.descrip,
                i.mfr,
                i.mfrpartno,
                i.vpartno,
                i.onhand,
                i.location,
                i.state,
                i.cost,
                i.supplier,
                i.stock,
                i.adddate,
                i.addtime,
                i.adduser,
                i.editdate,
                i.edittime,
                i.edituser,
                i.landing_synced_at,
                i.attributes,
                CASE WHEN sw.item IS NOT NULL THEN 1 ELSE 0 END AS in_software_vault
            {_INVENTORY_FROM}
            WHERE i.item = %s
              {sw_sql}
            """,
            (item_key,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    if not rows:
        raise HTTPException(status_code=404, detail=f"part not found: {item_key!r}")

    r = rows[0]
    detail = {
        "reference_key": _json_value(r.get("reference_key")),
        "item": _json_value(r.get("item")),
        "item_family": _json_value(r.get("item_family")),
        "item_subcategory": _json_value(r.get("item_subcategory")),
        "emaint_category": _json_value(r.get("emaint_category")),
        "descrip": _json_value(r.get("descrip")),
        "mfr": _json_value(r.get("mfr")),
        "mfrpartno": _json_value(r.get("mfrpartno")),
        "vpartno": _json_value(r.get("vpartno")),
        "onhand": _json_value(r.get("onhand")),
        "location": _json_value(r.get("location")),
        "state": _json_value(r.get("state")),
        "cost": _json_value(r.get("cost")),
        "supplier": _json_value(r.get("supplier")),
        "stock": _json_value(r.get("stock")),
        "adddate": _json_value(r.get("adddate")),
        "addtime": _json_value(r.get("addtime")),
        "adduser": _json_value(r.get("adduser")),
        "editdate": _json_value(r.get("editdate")),
        "edittime": _json_value(r.get("edittime")),
        "edituser": _json_value(r.get("edituser")),
        "landing_synced_at": _json_value(r.get("landing_synced_at")),
        "attributes": _parse_json_col(r.get("attributes")),
        "in_software_vault": bool(r.get("in_software_vault")),
        "emaint_url": EMAINT_ARINVT01_URL.format(item=item_key),
    }

    try:
        balance_rows = _field_query(
            """
            SELECT
                reference_key,
                bucket,
                condition,
                qty,
                updated_at
            FROM inventory.stock_balance
            WHERE item = %s
            ORDER BY bucket ASC, condition ASC
            """,
            (item_key,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    detail["balances"] = [
        {
            "reference_key": _json_value(b.get("reference_key")),
            "bucket": _json_value(b.get("bucket")),
            "condition": _json_value(b.get("condition")),
            "qty": _json_value(b.get("qty")),
            "updated_at": _json_value(b.get("updated_at")),
        }
        for b in balance_rows
    ]

    return detail
