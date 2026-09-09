"""Cabinet OEM BOM — browse lines + serve filed parts-catalog PDF."""

from __future__ import annotations

import mimetypes
import os
from datetime import date, datetime
from decimal import Decimal
from pathlib import PurePosixPath

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app import mssql
from app.parts_bom_paths import filed_path_to_rel, resolve_catalog_file

router = APIRouter(prefix="/api/parts-bom", tags=["parts-bom"])


def _catalog() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _q(sql: str, params=None):
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


def _bom_summary_row(r: dict) -> dict:
    filed = _json_value(r.get("document_filed_path"))
    doc_ok = False
    try:
        doc_ok = bool(filed and filed_path_to_rel(filed))
    except ValueError:
        doc_ok = False
    return {
        "bom_id": _json_value(r.get("bom_id")),
        "cabinet_id": _json_value(r.get("cabinet_id")),
        "version_name": _json_value(r.get("version_name")),
        "title": _json_value(r.get("title")),
        "source_revision": _json_value(r.get("source_revision")),
        "source_kind": _json_value(r.get("source_kind")),
        "document_file_name": _json_value(r.get("document_file_name")),
        "document_available": doc_ok,
        "line_count": int(r.get("line_count") or 0),
        "linked_count": int(r.get("linked_count") or 0),
    }


_BOM_SELECT = """
SELECT TOP 1
    b.bom_id,
    b.cabinet_id,
    b.version_name,
    b.title,
    b.source_revision,
    b.source_kind,
    b.document_filed_path,
    b.document_file_name,
    (SELECT COUNT(*)
     FROM vendors.parts_cabinet_bom_line AS l
     WHERE l.bom_id = b.bom_id AND l.is_active = 1) AS line_count,
    (SELECT COUNT(*)
     FROM vendors.parts_cabinet_bom_line AS l
     WHERE l.bom_id = b.bom_id AND l.is_active = 1 AND l.item IS NOT NULL) AS linked_count
FROM vendors.parts_cabinet_bom AS b
WHERE b.is_active = 1
"""


@router.get("/by-cabinet/{cabinet_id}")
def bom_by_cabinet(cabinet_id: str):
    cid = cabinet_id.strip()
    if not cid:
        raise HTTPException(status_code=400, detail="cabinet_id is required")
    try:
        rows = _q(
            _BOM_SELECT + " AND b.cabinet_id = %s ORDER BY b.source_date DESC, b.bom_id DESC",
            (cid,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    if not rows:
        return {"cabinet_id": cid, "bom": None}
    return {"cabinet_id": cid, "bom": _bom_summary_row(rows[0])}


@router.get("/{bom_id}")
def bom_detail(bom_id: str):
    bid = bom_id.strip()
    if not bid:
        raise HTTPException(status_code=400, detail="bom_id is required")
    try:
        rows = _q(_BOM_SELECT + " AND b.bom_id = %s", (bid,))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    if not rows:
        raise HTTPException(status_code=404, detail=f"bom not found: {bid!r}")
    return _bom_summary_row(rows[0])


@router.get("/{bom_id}/lines")
def bom_lines(
    bom_id: str,
    q: str = Query("", max_length=120),
    section: str = Query("", max_length=200),
    limit: int = Query(200, ge=1, le=500),
):
    bid = bom_id.strip()
    if not bid:
        raise HTTPException(status_code=400, detail="bom_id is required")

    try:
        exists = _q(
            "SELECT 1 AS ok FROM vendors.parts_cabinet_bom WHERE bom_id = %s AND is_active = 1",
            (bid,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    if not exists:
        raise HTTPException(status_code=404, detail=f"bom not found: {bid!r}")

    clauses = ["l.bom_id = %s", "l.is_active = 1"]
    params: list = [bid]
    needle = (q or "").strip()
    if needle:
        like = f"%{needle}%"
        clauses.append(
            "("
            "l.oem_part_no LIKE %s OR l.part_name LIKE %s OR l.section_name LIKE %s "
            "OR l.item LIKE %s OR l.option_group LIKE %s OR l.remarks LIKE %s"
            ")"
        )
        params.extend([like, like, like, like, like, like])
    sec = (section or "").strip()
    if sec:
        clauses.append("l.section_name = %s")
        params.append(sec)

    where = " AND ".join(clauses)
    top_n = int(limit)
    try:
        count_row = _q(
            f"SELECT COUNT(*) AS n FROM vendors.parts_cabinet_bom_line AS l WHERE {where}",
            tuple(params),
        )[0]
        rows = _q(
            f"""
            SELECT TOP {top_n}
                l.line_id,
                l.line_no,
                l.oem_part_no,
                l.part_name,
                l.qty,
                l.section_name,
                l.option_group,
                l.is_assembly,
                l.is_optional,
                l.item,
                l.link_confidence,
                l.remarks
            FROM vendors.parts_cabinet_bom_line AS l
            WHERE {where}
            ORDER BY
                CASE WHEN l.section_name IS NULL THEN 1 ELSE 0 END,
                l.section_name,
                l.line_no,
                l.oem_part_no
            """,
            tuple(params),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    lines = [
        {
            "line_id": _json_value(r.get("line_id")),
            "line_no": _json_value(r.get("line_no")),
            "oem_part_no": _json_value(r.get("oem_part_no")),
            "part_name": _json_value(r.get("part_name")),
            "qty": _json_value(r.get("qty")),
            "section_name": _json_value(r.get("section_name")),
            "option_group": _json_value(r.get("option_group")),
            "is_assembly": bool(r.get("is_assembly")),
            "is_optional": bool(r.get("is_optional")),
            "item": _json_value(r.get("item")),
            "link_confidence": _json_value(r.get("link_confidence")),
            "remarks": _json_value(r.get("remarks")),
        }
        for r in rows
    ]
    return {
        "bom_id": bid,
        "q": needle or None,
        "section": sec or None,
        "total": int(count_row.get("n") or 0),
        "returned": len(lines),
        "lines": lines,
    }


@router.get("/{bom_id}/document")
def bom_document(bom_id: str):
    bid = bom_id.strip()
    if not bid:
        raise HTTPException(status_code=400, detail="bom_id is required")
    try:
        rows = _q(
            """
            SELECT document_filed_path, document_file_name, document_mime
            FROM vendors.parts_cabinet_bom
            WHERE bom_id = %s AND is_active = 1
            """,
            (bid,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    if not rows:
        raise HTTPException(status_code=404, detail=f"bom not found: {bid!r}")

    filed = rows[0].get("document_filed_path")
    try:
        rel = filed_path_to_rel(filed)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="document path not filed") from exc
    if not rel:
        raise HTTPException(status_code=404, detail="document not filed")

    name = (rows[0].get("document_file_name") or PurePosixPath(rel).name).strip()
    media_type = (rows[0].get("document_mime") or "").strip() or None
    if not media_type:
        media_type, _ = mimetypes.guess_type(name)
    headers = {
        "Cache-Control": "private, max-age=300",
        "Content-Disposition": f'inline; filename="{name}"',
    }

    try:
        full = resolve_catalog_file(rel)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="document file not found on NAS") from exc

    return FileResponse(
        full,
        media_type=media_type or "application/pdf",
        headers=headers,
        filename=name,
    )
