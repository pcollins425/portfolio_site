"""Vendor distribution agreements.

The agreement belongs to a vendor. Casinos and clauses belong to the document
that states them. The live territory is the casino list on the latest document
with has_territory = 1, on an agreement that has not been replaced.
"""

from __future__ import annotations

import io
import mimetypes
import os
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from app import mssql
from app.document_paths import normalize_relative_path
from app.document_storage import read_bytes

router = APIRouter(tags=["distribution-agreements"])


def _catalog() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _query(sql: str, params=None):
    return mssql.query(sql, params=params, database=_catalog(), profile="field", load_env=False)


def _json_value(value: Any):
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, bool):
        return value
    return value


def _vendor_or_404(reference_key: str) -> dict:
    vid = (reference_key or "").strip()
    if not vid:
        raise HTTPException(status_code=400, detail="reference_key is required")
    rows = _query(
        """
        SELECT reference_key, vendor_name
        FROM vendors.vendors
        WHERE reference_key = %s
        """,
        (vid,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail=f"vendor not found: {vid!r}")
    return rows[0]


def _load_agreements(vendor_id: str) -> list[dict]:
    agreements = _query(
        """
        SELECT
            a.reference_key,
            a.agreement_number,
            a.replaced_agreement_id,
            prior.agreement_number AS replaced_agreement_number,
            CASE WHEN EXISTS (
                SELECT 1
                FROM vendors.distribution_agreement AS newer
                WHERE newer.replaced_agreement_id = a.reference_key
            ) THEN 0 ELSE 1 END AS governing,
            a.notes
        FROM vendors.distribution_agreement AS a
        LEFT JOIN vendors.distribution_agreement AS prior
            ON prior.reference_key = a.replaced_agreement_id
        WHERE a.vendor_id = %s
        ORDER BY a.agreement_number
        """,
        (vendor_id,),
    )
    if not agreements:
        return []

    ids = [row["reference_key"] for row in agreements]
    placeholders = ", ".join(["%s"] * len(ids))
    documents = _query(
        f"""
        SELECT
            reference_key,
            agreement_id,
            doc_kind,
            amendment_number,
            title,
            effective_on,
            has_territory,
            nas_rel_path,
            original_filename,
            notes
        FROM vendors.distribution_document
        WHERE agreement_id IN ({placeholders})
        ORDER BY effective_on, amendment_number, reference_key
        """,
        tuple(ids),
    )
    doc_ids = [row["reference_key"] for row in documents]
    casinos: list[dict] = []
    clauses: list[dict] = []
    if doc_ids:
        doc_placeholders = ", ".join(["%s"] * len(doc_ids))
        casinos = _query(
            f"""
            SELECT
                dc.document_id,
                dc.reference_key,
                dc.casino_id,
                dc.product_class,
                dc.source_grain,
                dc.source_label,
                dc.cabinet_limit,
                c.casino_name,
                c.casino_short
            FROM vendors.distribution_document_casino AS dc
            INNER JOIN clients.casinos AS c ON c.reference_key = dc.casino_id
            WHERE dc.document_id IN ({doc_placeholders})
            ORDER BY dc.product_class, c.casino_name, dc.reference_key
            """,
            tuple(doc_ids),
        )
        clauses = _query(
            f"""
            SELECT
                document_id,
                reference_key,
                clause_kind,
                summary,
                quantity,
                period,
                counts_leased,
                carry_forward,
                opening_credit_qty,
                opening_credit_year,
                cure_days,
                shortfall_is_debt,
                product_class,
                min_share_pct,
                min_net_win_per_unit,
                min_titles,
                index_name,
                lookback,
                term_end,
                remedy
            FROM vendors.distribution_document_clause
            WHERE document_id IN ({doc_placeholders})
            ORDER BY clause_kind, reference_key
            """,
            tuple(doc_ids),
        )

    current_by_agreement: dict[str, str] = {}
    ranked: dict[str, tuple] = {}
    for doc in documents:
        if not doc.get("has_territory"):
            continue
        key = (
            doc.get("effective_on") or date.min,
            doc.get("amendment_number") if doc.get("amendment_number") is not None else -1,
            doc.get("reference_key") or "",
        )
        agreement_id = doc["agreement_id"]
        if agreement_id not in ranked or key > ranked[agreement_id]:
            ranked[agreement_id] = key
            current_by_agreement[agreement_id] = doc["reference_key"]

    casinos_by_doc: dict[str, list] = {}
    for row in casinos:
        casinos_by_doc.setdefault(row["document_id"], []).append(
            {
                "reference_key": _json_value(row.get("reference_key")),
                "casino_id": _json_value(row.get("casino_id")),
                "casino_name": _json_value(row.get("casino_name")),
                "casino_short": _json_value(row.get("casino_short")),
                "product_class": _json_value(row.get("product_class")),
                "source_grain": _json_value(row.get("source_grain")),
                "source_label": _json_value(row.get("source_label")),
                "cabinet_limit": _json_value(row.get("cabinet_limit")),
            }
        )
    clauses_by_doc: dict[str, list] = {}
    for row in clauses:
        clauses_by_doc.setdefault(row["document_id"], []).append(
            {
                "reference_key": _json_value(row.get("reference_key")),
                "clause_kind": _json_value(row.get("clause_kind")),
                "summary": _json_value(row.get("summary")),
                "quantity": _json_value(row.get("quantity")),
                "period": _json_value(row.get("period")),
                "counts_leased": bool(row.get("counts_leased")) if row.get("counts_leased") is not None else None,
                "carry_forward": bool(row.get("carry_forward")) if row.get("carry_forward") is not None else None,
                "opening_credit_qty": _json_value(row.get("opening_credit_qty")),
                "opening_credit_year": _json_value(row.get("opening_credit_year")),
                "cure_days": _json_value(row.get("cure_days")),
                "shortfall_is_debt": bool(row.get("shortfall_is_debt")) if row.get("shortfall_is_debt") is not None else None,
                "product_class": _json_value(row.get("product_class")),
                "min_share_pct": _json_value(row.get("min_share_pct")),
                "min_net_win_per_unit": _json_value(row.get("min_net_win_per_unit")),
                "min_titles": _json_value(row.get("min_titles")),
                "index_name": _json_value(row.get("index_name")),
                "lookback": _json_value(row.get("lookback")),
                "term_end": _json_value(row.get("term_end")),
                "remedy": _json_value(row.get("remedy")),
            }
        )

    docs_by_agreement: dict[str, list] = {}
    for doc in documents:
        agreement_id = doc["agreement_id"]
        doc_id = doc["reference_key"]
        docs_by_agreement.setdefault(agreement_id, []).append(
            {
                "reference_key": _json_value(doc_id),
                "doc_kind": _json_value(doc.get("doc_kind")),
                "amendment_number": _json_value(doc.get("amendment_number")),
                "title": _json_value(doc.get("title")),
                "effective_on": _json_value(doc.get("effective_on")),
                "has_territory": bool(doc.get("has_territory")),
                "is_current_territory": current_by_agreement.get(agreement_id) == doc_id,
                "has_file": bool(doc.get("nas_rel_path")),
                "notes": _json_value(doc.get("notes")),
                "casinos": casinos_by_doc.get(doc_id, []),
                "clauses": clauses_by_doc.get(doc_id, []),
            }
        )

    return [
        {
            "reference_key": _json_value(row.get("reference_key")),
            "agreement_number": _json_value(row.get("agreement_number")),
            "replaced_agreement_id": _json_value(row.get("replaced_agreement_id")),
            "replaced_agreement_number": _json_value(row.get("replaced_agreement_number")),
            "governing": bool(row.get("governing")),
            "notes": _json_value(row.get("notes")),
            "documents": docs_by_agreement.get(row["reference_key"], []),
        }
        for row in agreements
    ]


@router.get("/api/commerce/vendors/{reference_key}/distribution-agreements")
def vendor_distribution_agreements(reference_key: str):
    vendor = _vendor_or_404(reference_key)
    try:
        agreements = _load_agreements(vendor["reference_key"])
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    return {
        "vendor_id": _json_value(vendor.get("reference_key")),
        "vendor_name": _json_value(vendor.get("vendor_name")),
        "agreements": agreements,
    }


@router.get("/api/commerce/casinos/{reference_key}/distribution-agreements")
def casino_distribution_agreements(reference_key: str):
    """Governing agreements whose current territory document lists this casino."""
    cid = (reference_key or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="reference_key is required")
    try:
        rows = _query(
            """
            WITH current_doc AS (
                SELECT
                    d.agreement_id,
                    d.reference_key AS document_id,
                    d.effective_on,
                    d.title,
                    ROW_NUMBER() OVER (
                        PARTITION BY d.agreement_id
                        ORDER BY d.effective_on DESC,
                                 ISNULL(d.amendment_number, -1) DESC,
                                 d.reference_key DESC
                    ) AS rn
                FROM vendors.distribution_document AS d
                WHERE d.has_territory = 1
            )
            SELECT
                a.reference_key AS agreement_id,
                a.agreement_number,
                a.vendor_id,
                v.vendor_name,
                cd.document_id,
                cd.effective_on,
                cd.title AS document_title,
                dc.product_class,
                dc.cabinet_limit,
                dc.source_label
            FROM current_doc AS cd
            INNER JOIN vendors.distribution_document_casino AS dc
                ON dc.document_id = cd.document_id
            INNER JOIN vendors.distribution_agreement AS a
                ON a.reference_key = cd.agreement_id
            INNER JOIN vendors.vendors AS v
                ON v.reference_key = a.vendor_id
            WHERE cd.rn = 1
              AND dc.casino_id = %s
              AND NOT EXISTS (
                    SELECT 1
                    FROM vendors.distribution_agreement AS newer
                    WHERE newer.replaced_agreement_id = a.reference_key
              )
            ORDER BY v.vendor_name, a.agreement_number, dc.product_class
            """,
            (cid,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    return {
        "casino_id": cid,
        "agreements": [
            {
                "agreement_id": _json_value(row.get("agreement_id")),
                "agreement_number": _json_value(row.get("agreement_number")),
                "vendor_id": _json_value(row.get("vendor_id")),
                "vendor_name": _json_value(row.get("vendor_name")),
                "document_id": _json_value(row.get("document_id")),
                "effective_on": _json_value(row.get("effective_on")),
                "document_title": _json_value(row.get("document_title")),
                "product_class": _json_value(row.get("product_class")),
                "cabinet_limit": _json_value(row.get("cabinet_limit")),
                "source_label": _json_value(row.get("source_label")),
            }
            for row in rows
        ],
    }


@router.get("/api/commerce/vendors/{reference_key}/distribution-documents/{document_id}/file")
def vendor_distribution_document_file(reference_key: str, document_id: str):
    vendor = _vendor_or_404(reference_key)
    rows = _query(
        """
        SELECT d.nas_rel_path, d.original_filename
        FROM vendors.distribution_document AS d
        INNER JOIN vendors.distribution_agreement AS a
            ON a.reference_key = d.agreement_id
        WHERE d.reference_key = %s
          AND a.vendor_id = %s
        """,
        (document_id.strip(), vendor["reference_key"]),
    )
    if not rows or not rows[0].get("nas_rel_path"):
        raise HTTPException(status_code=404, detail="document not found")
    try:
        rel = normalize_relative_path(rows[0]["nas_rel_path"])
        data = read_bytes(rel)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="document not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"NAS read failed: {exc}") from exc
    media_type, _ = mimetypes.guess_type(rel)
    filename = rows[0].get("original_filename") or rel.rsplit("/", 1)[-1]
    return StreamingResponse(
        io.BytesIO(data),
        media_type=media_type or "application/pdf",
        headers={
            "Cache-Control": "private, max-age=3600",
            "Content-Disposition": f'inline; filename="{filename}"',
        },
    )
