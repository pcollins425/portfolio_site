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
        "total_qty": float(r.get("total_qty") or 0),
        "software_descrips": _json_value(r.get("software_descrips")),
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


def _normalize_section(section: str) -> str:
    value = (section or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="section required")
    if len(value) > 20:
        raise HTTPException(status_code=400, detail="section too long")
    return value


def _slot_coord(value: int | str, *, field: str) -> str:
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"invalid {field}") from exc
    if number < 1 or number > 99:
        raise HTTPException(status_code=400, detail=f"{field} must be between 1 and 99")
    return f"{number:02d}"


def _section_row(r: dict) -> dict:
    return {
        "section": _json_value(r.get("section")),
        "row_count": int(r.get("row_count") or 0),
        "column_count": int(r.get("column_count") or 0),
        "label": _json_value(r.get("label")),
    }


def _bin_lookup_sql() -> str:
    return """
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
            (SELECT COUNT(*) FROM inventory.software AS s WHERE s.bin_id = b.uuid) AS software_count,
            (SELECT COALESCE(SUM(s.qty_on_hand), 0) FROM inventory.software AS s WHERE s.bin_id = b.uuid) AS total_qty
        FROM inventory.storage_bin AS b
    """


def _fetch_bin_by_uuid(bin_uuid: str) -> dict:
    rows = _field_query(
        f"{_bin_lookup_sql()} WHERE b.uuid = %s",
        (bin_uuid,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="bin not found")
    return _bin_row(rows[0])


def _assert_slot_available(section: str, row: str, column: str, *, exclude_uuid: str | None = None) -> None:
    params: list[Any] = [section, row, column]
    sql = """
        SELECT TOP 1 uuid
        FROM inventory.storage_bin
        WHERE is_active = 1
          AND section = %s
          AND [row] = %s
          AND [column] = %s
    """
    if exclude_uuid:
        sql += " AND uuid <> %s"
        params.append(exclude_uuid)
    rows = _field_query(sql, tuple(params))
    if rows:
        raise HTTPException(status_code=409, detail="slot already occupied")


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
                (SELECT COUNT(*) FROM inventory.software AS s WHERE s.bin_id = b.uuid) AS software_count,
                (SELECT COALESCE(SUM(s.qty_on_hand), 0) FROM inventory.software AS s WHERE s.bin_id = b.uuid) AS total_qty,
                (
                    SELECT STUFF((
                        SELECT DISTINCT N'; ' + NULLIF(LTRIM(RTRIM(s.descrip)), N'')
                        FROM inventory.software AS s
                        WHERE s.bin_id = b.uuid
                        FOR XML PATH(''), TYPE
                    ).value('.', 'NVARCHAR(MAX)'), 1, 2, N'')
                ) AS software_descrips
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


class CreateSectionBody(BaseModel):
    section: str = Field(..., min_length=1, max_length=20)
    rows: int = Field(..., ge=1, le=99)
    columns: int = Field(..., ge=1, le=99)
    label: str | None = Field(None, max_length=100)


class AddSectionRowsBody(BaseModel):
    rows: int = Field(1, ge=1, le=50)


class CreateBinsBody(BaseModel):
    count: int = Field(1, ge=1, le=50)


class BinSlotBody(BaseModel):
    section: str | None = Field(None, max_length=20)
    row: int | None = Field(None, ge=1, le=99)
    column: int | None = Field(None, ge=1, le=99)


@router.get("/layout")
def get_vault_layout():
    try:
        section_rows = _field_query(
            """
            SELECT section, row_count, column_count, label
            FROM inventory.storage_bin_section
            ORDER BY section
            """
        )
        inferred = _field_query(
            """
            SELECT
                b.section,
                MAX(TRY_CAST(b.[row] AS int)) AS row_count,
                MAX(TRY_CAST(b.[column] AS int)) AS column_count
            FROM inventory.storage_bin AS b
            WHERE b.is_active = 1
              AND b.section IS NOT NULL
              AND LTRIM(RTRIM(b.section)) <> N''
              AND b.[row] IS NOT NULL
              AND b.[column] IS NOT NULL
            GROUP BY b.section
            """
        )
        bins = _field_query(
            f"""
            {_bin_lookup_sql()}
            WHERE b.is_active = 1
            ORDER BY b.section, b.[row], b.[column], b.reference_key
            """
        )
        unslotted = _field_query(
            f"""
            {_bin_lookup_sql()}
            WHERE b.is_active = 1
              AND (
                b.section IS NULL OR LTRIM(RTRIM(b.section)) = N''
                OR b.[row] IS NULL OR LTRIM(RTRIM(b.[row])) = N''
                OR b.[column] IS NULL OR LTRIM(RTRIM(b.[column])) = N''
              )
            ORDER BY b.reference_key
            """
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    sections: dict[str, dict] = {}
    for row in section_rows:
        item = _section_row(row)
        sections[item["section"]] = item

    for row in inferred:
        section = _json_value(row.get("section"))
        if not section:
            continue
        inferred_rows = int(row.get("row_count") or 1)
        inferred_cols = int(row.get("column_count") or 1)
        if section in sections:
            sections[section]["row_count"] = max(sections[section]["row_count"], inferred_rows)
            sections[section]["column_count"] = max(sections[section]["column_count"], inferred_cols)
        else:
            sections[section] = {
                "section": section,
                "row_count": inferred_rows,
                "column_count": inferred_cols,
                "label": section,
            }

    bins_by_section: dict[str, list[dict]] = {}
    for row in bins:
        if not row.get("section"):
            continue
        section = _json_value(row.get("section"))
        bins_by_section.setdefault(section, []).append(_bin_row(row))

    layout_sections = []
    for section in sorted(sections.keys()):
        meta = sections[section]
        row_count = int(meta["row_count"] or 1)
        col_count = int(meta["column_count"] or 1)
        placed = {
            (b.get("row"), b.get("column")): b
            for b in bins_by_section.get(section, [])
            if b.get("row") and b.get("column")
        }
        cells = []
        for row_num in range(1, row_count + 1):
            row_key = _slot_coord(row_num, field="row")
            for col_num in range(1, col_count + 1):
                col_key = _slot_coord(col_num, field="column")
                cells.append(
                    {
                        "row": row_key,
                        "column": col_key,
                        "shelf_code": f"{section}-{row_key}-{col_key}",
                        "bin": placed.get((row_key, col_key)),
                    }
                )
        layout_sections.append(
            {
                **meta,
                "row_count": row_count,
                "column_count": col_count,
                "cells": cells,
            }
        )

    return {
        "sections": layout_sections,
        "unslotted_bins": [_bin_row(r) for r in unslotted],
    }


@router.post("/layout/sections")
def create_vault_section(body: CreateSectionBody):
    section = _normalize_section(body.section)
    try:
        existing = _field_query(
            "SELECT 1 AS ok FROM inventory.storage_bin_section WHERE section = %s",
            (section,),
        )
        if existing:
            raise HTTPException(status_code=409, detail="section already exists")
        _field_execute(
            """
            INSERT INTO inventory.storage_bin_section (section, row_count, column_count, label)
            VALUES (%s, %s, %s, %s)
            """,
            (section, body.rows, body.columns, (body.label or "").strip() or section),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    return get_vault_layout()


@router.post("/layout/sections/{section}/add-rows")
def add_vault_section_rows(section: str, body: AddSectionRowsBody):
    key = _normalize_section(section)
    try:
        rows = _field_query(
            "SELECT section, row_count, column_count, label FROM inventory.storage_bin_section WHERE section = %s",
            (key,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail="section not found")
        new_count = int(rows[0]["row_count"]) + body.rows
        if new_count > 99:
            raise HTTPException(status_code=400, detail="section cannot exceed 99 rows")
        _field_execute(
            """
            UPDATE inventory.storage_bin_section
            SET row_count = %s, updated_at = SYSUTCDATETIME()
            WHERE section = %s
            """,
            (new_count, key),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    return get_vault_layout()


@router.post("/bins")
def create_bins(body: CreateBinsBody):
    created = []
    try:
        for _ in range(body.count):
            _field_execute(
                """
                INSERT INTO inventory.storage_bin (label)
                VALUES (NULL)
                """
            )
            row = _field_query(
                f"""
                {_bin_lookup_sql()}
                WHERE b.index_key = (SELECT MAX(index_key) FROM inventory.storage_bin)
                """
            )[0]
            created.append(_bin_row(row))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    return {"items": created, "count": len(created)}


@router.patch("/bins/{bin_uuid}/slot")
def update_bin_slot(bin_uuid: str, body: BinSlotBody):
    section_raw = (body.section or "").strip()
    if not section_raw:
        try:
            n = _field_execute(
                """
                UPDATE inventory.storage_bin
                SET section = NULL, [row] = NULL, [column] = NULL, updated_at = SYSUTCDATETIME()
                WHERE uuid = %s AND is_active = 1
                """,
                (bin_uuid,),
            )
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
        if not n:
            raise HTTPException(status_code=404, detail="bin not found")
        return {"bin": _fetch_bin_by_uuid(bin_uuid)}

    if body.row is None or body.column is None:
        raise HTTPException(status_code=400, detail="row and column required when placing a bin")
    section = _normalize_section(section_raw)
    row = _slot_coord(body.row, field="row")
    column = _slot_coord(body.column, field="column")
    _assert_slot_available(section, row, column, exclude_uuid=bin_uuid)

    try:
        layout = _field_query(
            "SELECT row_count, column_count FROM inventory.storage_bin_section WHERE section = %s",
            (section,),
        )
        if layout:
            if int(body.row) > int(layout[0]["row_count"]) or int(body.column) > int(layout[0]["column_count"]):
                raise HTTPException(status_code=400, detail="slot outside section grid")
        n = _field_execute(
            """
            UPDATE inventory.storage_bin
            SET section = %s, [row] = %s, [column] = %s, label = %s, updated_at = SYSUTCDATETIME()
            WHERE uuid = %s AND is_active = 1
            """,
            (section, row, column, f"{section}-{row}-{column}", bin_uuid),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    if not n:
        raise HTTPException(status_code=404, detail="bin not found")
    return {"bin": _fetch_bin_by_uuid(bin_uuid)}


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
