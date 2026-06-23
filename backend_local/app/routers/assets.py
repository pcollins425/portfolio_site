"""Assets browse API — inventory.compinfo_landing + vendor/cabinet media."""

from __future__ import annotations

import math
import os
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query

from app import mssql

router = APIRouter(prefix="/api/assets", tags=["assets"])

_ASSET_FROM = """
    FROM inventory.compinfo_landing AS ci
    LEFT JOIN inventory.assets AS a ON a.reference_key = ci.asset_id
    LEFT JOIN vendors.vendors AS v ON v.reference_key = a.vendor_id
    LEFT JOIN vendors.cabinets AS cab ON cab.reference_key = a.cabinet_id
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
    if isinstance(v, Decimal):
        return float(v)
    if v is None:
        return None
    return str(v).strip() if isinstance(v, str) else v


@router.get("/summary")
def assets_summary():
    """Stat cards for assets browse."""
    try:
        row = _field_query(
            f"""
            SELECT
                COUNT(*) AS total,
                COUNT(DISTINCT NULLIF(LTRIM(RTRIM(ci.property)), N'')) AS properties,
                SUM(CASE WHEN ci.asset_id IS NULL OR LTRIM(RTRIM(ci.asset_id)) = N''
                    THEN 1 ELSE 0 END) AS missing_asset_links,
                SUM(CASE WHEN ci.status IS NOT NULL AND LTRIM(RTRIM(ci.status)) <> N''
                    THEN 1 ELSE 0 END) AS with_status
            {_ASSET_FROM}
            """
        )[0]
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    return {
        "total": int(row["total"]),
        "properties": int(row["properties"] or 0),
        "missing_asset_links": int(row["missing_asset_links"] or 0),
        "with_status": int(row["with_status"] or 0),
    }


@router.get("")
def list_assets(
    q: str = Query("", max_length=120, description="Search asset ID, serial, title, property, status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """Paginated asset browse list."""
    search = q.strip()
    like = f"%{search}%" if search else None

    search_sql = ""
    search_params: tuple = ()
    if like:
        search_sql = """
            AND (
                ci.compid LIKE %s
                OR ci.serial_no LIKE %s
                OR ci.asset_id LIKE %s
                OR ci.comp_desc LIKE %s
                OR ci.property LIKE %s
                OR ci.status LIKE %s
                OR v.vendor_name LIKE %s
                OR cab.cabinet_name LIKE %s
            )
        """
        search_params = (like,) * 8

    try:
        count_row = _field_query(
            f"""
            SELECT COUNT(*) AS n
            {_ASSET_FROM}
            WHERE 1=1
            {search_sql}
            """,
            search_params,
        )[0]
        total = int(count_row["n"])

        offset = (page - 1) * page_size
        rows = _field_query(
            f"""
            SELECT
                ci.compid,
                ci.serial_no,
                ci.asset_id,
                ci.comp_desc,
                ci.property,
                ci.status,
                v.vendor_name,
                cab.cabinet_name
            {_ASSET_FROM}
            WHERE 1=1
            {search_sql}
            ORDER BY ci.compid DESC
            OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY
            """,
            search_params,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    items = [
        {
            "compid": _json_value(r.get("compid")),
            "serial_no": _json_value(r.get("serial_no")),
            "asset_id": _json_value(r.get("asset_id")),
            "comp_desc": _json_value(r.get("comp_desc")),
            "property": _json_value(r.get("property")),
            "status": _json_value(r.get("status")),
            "vendor_name": _json_value(r.get("vendor_name")),
            "cabinet_name": _json_value(r.get("cabinet_name")),
        }
        for r in rows
    ]

    total_pages = max(1, math.ceil(total / page_size)) if total else 1

    return {
        "items": items,
        "search": search or None,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
    }


@router.get("/{compid}")
def asset_detail(compid: str):
    """Single asset with vendor/cabinet media paths."""
    key = compid.strip()
    if not key:
        raise HTTPException(status_code=400, detail="compid is required")

    try:
        rows = _field_query(
            f"""
            SELECT
                ci.compid,
                ci.serial_no,
                ci.asset_id,
                ci.property,
                ci.status,
                ci.comp_desc,
                ci.manufac,
                ci.model_no,
                ci.assettype,
                ci.state,
                ci.tribe,
                ci.zone,
                ci.bank,
                ci.location,
                ci.class,
                ci.date_instl,
                ci.golive001,
                ci.rmvl_date,
                ci.denom,
                ci.bet_line,
                ci.betconfig,
                ci.prog_media,
                ci.paytable,
                ci.comment,
                ci.editdate,
                ci.edituser,
                a.vendor_id,
                a.cabinet_id,
                v.vendor_name,
                v.logo_media_path AS vendor_logo_media_path,
                cab.cabinet_name,
                cab.image_media_path AS cabinet_image_media_path
            {_ASSET_FROM}
            WHERE ci.compid = %s
            """,
            (key,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    if not rows:
        raise HTTPException(status_code=404, detail=f"asset not found: {key!r}")

    r = rows[0]
    return {
        "compid": _json_value(r.get("compid")),
        "serial_no": _json_value(r.get("serial_no")),
        "asset_id": _json_value(r.get("asset_id")),
        "property": _json_value(r.get("property")),
        "status": _json_value(r.get("status")),
        "comp_desc": _json_value(r.get("comp_desc")),
        "manufac": _json_value(r.get("manufac")),
        "model_no": _json_value(r.get("model_no")),
        "assettype": _json_value(r.get("assettype")),
        "state": _json_value(r.get("state")),
        "tribe": _json_value(r.get("tribe")),
        "zone": _json_value(r.get("zone")),
        "bank": _json_value(r.get("bank")),
        "location": _json_value(r.get("location")),
        "class": _json_value(r.get("class")),
        "date_instl": _json_value(r.get("date_instl")),
        "golive001": _json_value(r.get("golive001")),
        "rmvl_date": _json_value(r.get("rmvl_date")),
        "denom": _json_value(r.get("denom")),
        "bet_line": _json_value(r.get("bet_line")),
        "betconfig": _json_value(r.get("betconfig")),
        "prog_media": _json_value(r.get("prog_media")),
        "paytable": _json_value(r.get("paytable")),
        "comment": _json_value(r.get("comment")),
        "editdate": _json_value(r.get("editdate")),
        "edituser": _json_value(r.get("edituser")),
        "vendor_id": _json_value(r.get("vendor_id")),
        "cabinet_id": _json_value(r.get("cabinet_id")),
        "vendor_name": _json_value(r.get("vendor_name")),
        "cabinet_name": _json_value(r.get("cabinet_name")),
        "vendor_logo_media_path": _json_value(r.get("vendor_logo_media_path")),
        "cabinet_image_media_path": _json_value(r.get("cabinet_image_media_path")),
    }
