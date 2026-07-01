"""Software Vault API — bins, software catalog, kits (inventory schema)."""

from __future__ import annotations

import json
import math
import os
import uuid as uuid_mod
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app import mssql

router = APIRouter(prefix="/api/software-vault", tags=["software-vault"])


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


def _field_execute(sql: str, params=None):
    return mssql.execute(
        sql,
        params=params,
        database=_catalog(),
        profile="field",
        load_env=False,
    )


def _json_value(v: Any):
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, uuid_mod.UUID):
        return str(v)
    if v is None:
        return None
    return str(v).strip() if isinstance(v, str) else v


def _parse_json_col(raw: Any) -> Any:
    if raw is None or raw == "":
        return None
    if isinstance(raw, (list, dict)):
        return raw
    try:
        return json.loads(str(raw))
    except json.JSONDecodeError:
        return raw


def _bin_row(r: dict) -> dict:
    return {
        "uuid": _json_value(r.get("uuid")),
        "reference_key": _json_value(r.get("reference_key")),
        "barcode": _json_value(r.get("barcode")),
        "section": _json_value(r.get("section")),
        "row": _json_value(r.get("row")),
        "column": _json_value(r.get("column")),
        "shelf_code": _json_value(r.get("shelf_code")),
        "label": _json_value(r.get("label")),
        "is_active": bool(r.get("is_active")) if r.get("is_active") is not None else True,
        "software_count": int(r.get("software_count") or 0),
    }


def _software_row(r: dict, *, include_meta: bool = False) -> dict:
    out = {
        "uuid": _json_value(r.get("uuid")),
        "reference_key": _json_value(r.get("reference_key")),
        "item": _json_value(r.get("item")),
        "descrip": _json_value(r.get("descrip")),
        "category": _json_value(r.get("category")),
        "supplier_part_no": _json_value(r.get("supplier_part_no")),
        "qty_on_hand": _json_value(r.get("qty_on_hand")),
        "bin_id": _json_value(r.get("bin_id")),
        "shelf_code": _json_value(r.get("shelf_code")),
        "bin_barcode": _json_value(r.get("bin_barcode")),
        "cabinets": _parse_json_col(r.get("cabinets")),
    }
    if include_meta:
        out["metadata"] = _parse_json_col(r.get("metadata"))
        out["landing_synced_at"] = _json_value(r.get("landing_synced_at"))
    return out


@router.get("/summary")
def vault_summary():
    try:
        row = _field_query(
            """
            SELECT
                (SELECT COUNT(*) FROM inventory.storage_bin WHERE is_active = 1) AS bins,
                (SELECT COUNT(*) FROM inventory.software) AS software,
                (SELECT COUNT(*) FROM inventory.software WHERE bin_id IS NULL) AS unplaced,
                (SELECT COUNT(*) FROM inventory.kit) AS kits,
                (SELECT COUNT(*) FROM inventory.kit_line) AS kit_lines
            """
        )[0]
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    return {
        "bins": int(row["bins"] or 0),
        "software": int(row["software"] or 0),
        "unplaced": int(row["unplaced"] or 0),
        "kits": int(row["kits"] or 0),
        "kit_lines": int(row["kit_lines"] or 0),
    }


@router.get("/bins")
def list_bins(
    q: str = Query("", max_length=80),
    section: str = Query("", max_length=20),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
):
    search = q.strip()
    sec = section.strip()
    where = ["b.is_active = 1"]
    params: list[Any] = []
    if search:
        like = f"%{search}%"
        where.append(
            "(b.shelf_code LIKE %s OR b.reference_key LIKE %s OR b.barcode LIKE %s OR b.label LIKE %s)"
        )
        params.extend([like, like, like, like])
    if sec:
        where.append("b.section = %s")
        params.append(sec)
    where_sql = " AND ".join(where)

    try:
        total = int(
            _field_query(
                f"SELECT COUNT(*) AS n FROM inventory.storage_bin AS b WHERE {where_sql}",
                tuple(params),
            )[0]["n"]
        )
        offset = (page - 1) * page_size
        rows = _field_query(
            f"""
            SELECT
                b.uuid,
                b.reference_key,
                b.barcode,
                b.section,
                b.[row],
                b.[column],
                b.shelf_code,
                b.label,
                b.is_active,
                (SELECT COUNT(*) FROM inventory.software AS s WHERE s.bin_id = b.uuid) AS software_count
            FROM inventory.storage_bin AS b
            WHERE {where_sql}
            ORDER BY b.shelf_code, b.reference_key
            OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY
            """,
            tuple(params),
        )
        sections = _field_query(
            """
            SELECT DISTINCT section
            FROM inventory.storage_bin
            WHERE is_active = 1 AND section IS NOT NULL AND LTRIM(RTRIM(section)) <> N''
            ORDER BY section
            """
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    return {
        "items": [_bin_row(r) for r in rows],
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": max(1, math.ceil(total / page_size)) if total else 1,
        "sections": [_json_value(r["section"]) for r in sections if r.get("section")],
    }


@router.get("/scan")
def scan_resolve(q: str = Query(..., min_length=1, max_length=80)):
    """Resolve BIN: barcode, BIN- reference_key, or shelf_code."""
    raw = q.strip()
    if not raw:
        raise HTTPException(status_code=400, detail="empty scan code")
    code = raw.upper()
    if code.startswith("BIN:"):
        code = raw[4:].strip()
    try:
        rows = _field_query(
            """
            SELECT TOP 1
                b.uuid,
                b.reference_key,
                b.barcode,
                b.section,
                b.[row],
                b.[column],
                b.shelf_code,
                b.label,
                b.is_active,
                (SELECT COUNT(*) FROM inventory.software AS s WHERE s.bin_id = b.uuid) AS software_count
            FROM inventory.storage_bin AS b
            WHERE b.barcode = %s
               OR b.reference_key = %s
               OR b.shelf_code = %s
            ORDER BY b.is_active DESC, b.shelf_code
            """,
            (raw, code, raw),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    if not rows:
        raise HTTPException(status_code=404, detail="bin not found")
    return {"bin": _bin_row(rows[0])}


@router.get("/bins/{bin_uuid}")
def get_bin(bin_uuid: str):
    try:
        rows = _field_query(
            """
            SELECT
                b.uuid,
                b.reference_key,
                b.barcode,
                b.section,
                b.[row],
                b.[column],
                b.shelf_code,
                b.label,
                b.is_active,
                (SELECT COUNT(*) FROM inventory.software AS s WHERE s.bin_id = b.uuid) AS software_count
            FROM inventory.storage_bin AS b
            WHERE b.uuid = %s
            """,
            (bin_uuid,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    if not rows:
        raise HTTPException(status_code=404, detail="bin not found")

    try:
        software = _field_query(
            """
            SELECT
                s.uuid,
                s.reference_key,
                s.item,
                s.descrip,
                s.category,
                s.supplier_part_no,
                s.qty_on_hand,
                s.bin_id,
                b.shelf_code,
                b.barcode AS bin_barcode,
                s.cabinets
            FROM inventory.software AS s
            LEFT JOIN inventory.storage_bin AS b ON b.uuid = s.bin_id
            WHERE s.bin_id = %s
            ORDER BY s.descrip, s.item
            """,
            (bin_uuid,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    return {
        "bin": _bin_row(rows[0]),
        "software": [_software_row(r) for r in software],
    }


@router.get("/software")
def list_software(
    q: str = Query("", max_length=120),
    unplaced_only: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    search = q.strip()
    where = ["1=1"]
    params: list[Any] = []
    if unplaced_only:
        where.append("s.bin_id IS NULL")
    if search:
        like = f"%{search}%"
        where.append(
            "(s.item LIKE %s OR s.descrip LIKE %s OR s.category LIKE %s OR s.supplier_part_no LIKE %s)"
        )
        params.extend([like, like, like, like])
    where_sql = " AND ".join(where)

    try:
        total = int(
            _field_query(
                f"SELECT COUNT(*) AS n FROM inventory.software AS s WHERE {where_sql}",
                tuple(params),
            )[0]["n"]
        )
        offset = (page - 1) * page_size
        rows = _field_query(
            f"""
            SELECT
                s.uuid,
                s.reference_key,
                s.item,
                s.descrip,
                s.category,
                s.supplier_part_no,
                s.qty_on_hand,
                s.bin_id,
                b.shelf_code,
                b.barcode AS bin_barcode,
                s.cabinets
            FROM inventory.software AS s
            LEFT JOIN inventory.storage_bin AS b ON b.uuid = s.bin_id
            WHERE {where_sql}
            ORDER BY s.descrip, s.item
            OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY
            """,
            tuple(params),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    return {
        "items": [_software_row(r) for r in rows],
        "page": page,
        "page_size": page_size,
        "total": total,
        "pages": max(1, math.ceil(total / page_size)) if total else 1,
    }


@router.get("/software/{item}")
def get_software(item: str):
    key = item.strip()
    try:
        rows = _field_query(
            """
            SELECT
                s.uuid,
                s.reference_key,
                s.item,
                s.descrip,
                s.category,
                s.supplier_part_no,
                s.qty_on_hand,
                s.bin_id,
                b.shelf_code,
                b.barcode AS bin_barcode,
                s.cabinets,
                s.metadata,
                s.landing_synced_at
            FROM inventory.software AS s
            LEFT JOIN inventory.storage_bin AS b ON b.uuid = s.bin_id
            WHERE s.item = %s
            """,
            (key,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    if not rows:
        raise HTTPException(status_code=404, detail="software not found")
    return _software_row(rows[0], include_meta=True)


class PlacementBody(BaseModel):
    bin_id: str | None = Field(None, description="storage_bin.uuid, or null to unplace")


@router.patch("/software/{item}/placement")
def update_software_placement(item: str, body: PlacementBody):
    key = item.strip()
    bin_id = (body.bin_id or "").strip() or None
    if bin_id:
        try:
            found = _field_query(
                "SELECT 1 AS ok FROM inventory.storage_bin WHERE uuid = %s AND is_active = 1",
                (bin_id,),
            )
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
        if not found:
            raise HTTPException(status_code=400, detail="bin not found or inactive")
    try:
        n = _field_execute(
            """
            UPDATE inventory.software
            SET bin_id = %s, updated_at = SYSUTCDATETIME()
            WHERE item = %s
            """,
            (bin_id, key),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    if not n:
        raise HTTPException(status_code=404, detail="software not found")
    return get_software(key)


@router.get("/kits")
def list_kits():
    try:
        rows = _field_query(
            """
            SELECT
                k.kit_item,
                k.descrip,
                (SELECT COUNT(*) FROM inventory.kit_line AS kl WHERE kl.kit_item = k.kit_item) AS line_count
            FROM inventory.kit AS k
            ORDER BY k.kit_item
            """
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    return {
        "items": [
            {
                "kit_item": _json_value(r["kit_item"]),
                "descrip": _json_value(r.get("descrip")),
                "line_count": int(r.get("line_count") or 0),
            }
            for r in rows
        ]
    }


@router.get("/kits/{kit_item}/pull")
def kit_pull_checklist(kit_item: str):
    key = kit_item.strip()
    try:
        kit_rows = _field_query(
            "SELECT kit_item, descrip FROM inventory.kit WHERE kit_item = %s",
            (key,),
        )
        lines = _field_query(
            """
            SELECT
                kl.cuid,
                kl.component_item,
                kl.qty AS kit_qty,
                s.descrip,
                s.qty_on_hand,
                s.bin_id,
                b.shelf_code,
                b.barcode AS bin_barcode,
                b.reference_key AS bin_reference_key
            FROM inventory.kit_line AS kl
            LEFT JOIN inventory.software AS s ON s.item = kl.component_item
            LEFT JOIN inventory.storage_bin AS b ON b.uuid = s.bin_id
            WHERE kl.kit_item = %s
            ORDER BY kl.component_item
            """,
            (key,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    if not kit_rows:
        raise HTTPException(status_code=404, detail="kit not found")

    return {
        "kit_item": _json_value(kit_rows[0]["kit_item"]),
        "descrip": _json_value(kit_rows[0].get("descrip")),
        "lines": [
            {
                "cuid": _json_value(r.get("cuid")),
                "component_item": _json_value(r.get("component_item")),
                "kit_qty": _json_value(r.get("kit_qty")),
                "descrip": _json_value(r.get("descrip")),
                "qty_on_hand": _json_value(r.get("qty_on_hand")),
                "bin_id": _json_value(r.get("bin_id")),
                "shelf_code": _json_value(r.get("shelf_code")),
                "bin_barcode": _json_value(r.get("bin_barcode")),
                "bin_reference_key": _json_value(r.get("bin_reference_key")),
            }
            for r in lines
        ],
    }
