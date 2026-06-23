"""Vendor contracts read API — inventory.contract* tables."""

from __future__ import annotations

import math
import os
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query

from app import mssql

router = APIRouter(prefix="/api/contracts", tags=["contracts"])


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


def _money(v) -> float | None:
    val = _json_value(v)
    if val is None:
        return None
    return float(val)


@router.get("/health")
def contracts_health():
    catalog = _catalog()
    ok = False
    n = None
    try:
        row = _field_query("SELECT COUNT(*) AS n FROM inventory.contract")[0]
        n = int(row["n"])
        ok = True
    except Exception:
        pass
    ext = os.environ.get("MSSQL_EXTERNAL") or os.environ.get("MSSQL_HOST")
    return {
        "ok": ok,
        "database": catalog,
        "contract_count": n,
        "host": ext,
    }


@router.get("/summary")
def contracts_summary():
    """Stat cards: agreements, lines, serials, missing assets."""
    try:
        row = _field_query(
            """
            SELECT
                (SELECT COUNT(*) FROM inventory.contract) AS agreements,
                (SELECT COUNT(*) FROM inventory.contract_line) AS lines,
                (SELECT COUNT(*) FROM inventory.contract_line_serial) AS serials,
                (SELECT COUNT(*)
                 FROM inventory.contract_line_serial
                 WHERE asset_id IS NULL) AS missing_assets
            """
        )[0]
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    return {
        "agreements": int(row["agreements"]),
        "lines": int(row["lines"]),
        "serials": int(row["serials"]),
        "missing_assets": int(row["missing_assets"]),
    }


@router.get("")
def list_contracts(
    q: str = Query("", max_length=120, description="Search agreement ID, vendor, SO#"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """Paginated contract browse list."""
    search = q.strip()
    like = f"%{search}%" if search else None

    search_sql = ""
    search_params: tuple = ()
    if like:
        search_sql = """
            AND (
                c.agreement_id LIKE %s
                OR v.vendor_name LIKE %s
                OR c.sales_order LIKE %s
                OR c.reference_key LIKE %s
            )
        """
        search_params = (like, like, like, like)

    try:
        count_row = _field_query(
            f"""
            SELECT COUNT(*) AS n
            FROM inventory.contract c
            INNER JOIN vendors.vendors v ON v.reference_key = c.vendor_id
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
                c.reference_key,
                c.agreement_id,
                c.vendor_id,
                v.vendor_name,
                c.sales_order,
                c.agreement_date,
                c.total_price,
                c.date_received
            FROM inventory.contract c
            INNER JOIN vendors.vendors v ON v.reference_key = c.vendor_id
            WHERE 1=1
            {search_sql}
            ORDER BY c.agreement_date DESC, c.agreement_id DESC
            OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY
            """,
            search_params,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    items = [
        {
            "reference_key": _json_value(r.get("reference_key")),
            "agreement_id": _json_value(r.get("agreement_id")),
            "vendor_id": _json_value(r.get("vendor_id")),
            "vendor_name": _json_value(r.get("vendor_name")),
            "sales_order": _json_value(r.get("sales_order")),
            "agreement_date": _json_value(r.get("agreement_date")),
            "total_price": _money(r.get("total_price")),
            "date_received": _json_value(r.get("date_received")),
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


@router.get("/lines/{line_reference_key}/serials")
def line_serials(line_reference_key: str):
    """Serial numbers for one contract line."""
    key = line_reference_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="line reference_key is required")

    try:
        exists = _field_query(
            """
            SELECT reference_key
            FROM inventory.contract_line
            WHERE reference_key = %s
            """,
            (key,),
        )
        if not exists:
            raise HTTPException(status_code=404, detail=f"contract line not found: {key!r}")

        rows = _field_query(
            """
            SELECT serial_number, asset_id
            FROM inventory.contract_line_serial
            WHERE contract_line_id = %s
            ORDER BY serial_number
            """,
            (key,),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    serials = [
        {
            "serial_number": _json_value(r.get("serial_number")),
            "asset_id": _json_value(r.get("asset_id")),
            "linked": bool(r.get("asset_id")),
        }
        for r in rows
    ]

    return {
        "line_reference_key": key,
        "serials": serials,
        "total": len(serials),
        "linked": sum(1 for s in serials if s["linked"]),
        "missing": sum(1 for s in serials if not s["linked"]),
    }


@router.get("/{reference_key}")
def contract_detail(reference_key: str):
    """Contract header + line items with serial counts."""
    key = reference_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="reference_key is required")

    try:
        header_rows = _field_query(
            """
            SELECT
                c.reference_key,
                c.agreement_id,
                c.vendor_id,
                v.vendor_name,
                v.logo_media_path AS vendor_logo_media_path,
                c.agreement_date,
                c.sales_order,
                c.total_price,
                c.date_received,
                c.delivery_location,
                c.payment_terms,
                c.payment_date,
                c.contract_file,
                c.notes
            FROM inventory.contract c
            INNER JOIN vendors.vendors v ON v.reference_key = c.vendor_id
            WHERE c.reference_key = %s
            """,
            (key,),
        )
        if not header_rows:
            raise HTTPException(status_code=404, detail=f"contract not found: {key!r}")

        line_rows = _field_query(
            """
            SELECT
                cl.reference_key,
                cl.asset_type,
                cl.asset_description,
                cl.cabinet_id,
                cab.cabinet_name,
                cab.image_media_path AS cabinet_image_media_path,
                cl.machine_cost,
                cl.quantity,
                cl.date_received,
                cl.notes,
                (
                    SELECT COUNT(*)
                    FROM inventory.contract_line_serial s
                    WHERE s.contract_line_id = cl.reference_key
                ) AS serial_count,
                (
                    SELECT COUNT(*)
                    FROM inventory.contract_line_serial s
                    WHERE s.contract_line_id = cl.reference_key
                      AND s.asset_id IS NOT NULL
                ) AS linked_serial_count
            FROM inventory.contract_line cl
            LEFT JOIN vendors.cabinets cab ON cab.reference_key = cl.cabinet_id
            WHERE cl.contract_id = %s
            ORDER BY cl.asset_description, cl.reference_key
            """,
            (key,),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    h = header_rows[0]
    lines = [
        {
            "reference_key": _json_value(r.get("reference_key")),
            "asset_type": _json_value(r.get("asset_type")),
            "asset_description": _json_value(r.get("asset_description")),
            "cabinet_id": _json_value(r.get("cabinet_id")),
            "cabinet_name": _json_value(r.get("cabinet_name")),
            "cabinet_image_media_path": _json_value(r.get("cabinet_image_media_path")),
            "machine_cost": _money(r.get("machine_cost")),
            "quantity": int(r["quantity"]) if r.get("quantity") is not None else None,
            "date_received": _json_value(r.get("date_received")),
            "notes": _json_value(r.get("notes")),
            "serial_count": int(r.get("serial_count") or 0),
            "linked_serial_count": int(r.get("linked_serial_count") or 0),
        }
        for r in line_rows
    ]

    cabinet_images: list[dict] = []
    seen_cab: set[str] = set()
    for ln in lines:
        cid = ln.get("cabinet_id")
        img = ln.get("cabinet_image_media_path")
        if not cid or not img or cid in seen_cab:
            continue
        seen_cab.add(cid)
        cabinet_images.append(
            {
                "cabinet_id": cid,
                "cabinet_name": ln.get("cabinet_name"),
                "image_media_path": img,
            }
        )

    return {
        "reference_key": _json_value(h.get("reference_key")),
        "agreement_id": _json_value(h.get("agreement_id")),
        "vendor_id": _json_value(h.get("vendor_id")),
        "vendor_name": _json_value(h.get("vendor_name")),
        "vendor_logo_media_path": _json_value(h.get("vendor_logo_media_path")),
        "agreement_date": _json_value(h.get("agreement_date")),
        "sales_order": _json_value(h.get("sales_order")),
        "total_price": _money(h.get("total_price")),
        "date_received": _json_value(h.get("date_received")),
        "delivery_location": _json_value(h.get("delivery_location")),
        "payment_terms": _json_value(h.get("payment_terms")),
        "payment_date": _json_value(h.get("payment_date")),
        "contract_file": _json_value(h.get("contract_file")),
        "notes": _json_value(h.get("notes")),
        "lines": lines,
        "cabinet_images": cabinet_images,
        "line_count": len(lines),
        "serial_count": sum(ln["serial_count"] for ln in lines),
        "linked_serial_count": sum(ln["linked_serial_count"] for ln in lines),
    }
