"""Read-only Commerce APIs — clients.casinos, vendors.vendors."""

from __future__ import annotations

import math
import os
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query

from app import mssql

casinos_router = APIRouter(prefix="/api/commerce/casinos", tags=["commerce-casinos"])
vendors_router = APIRouter(prefix="/api/commerce/vendors", tags=["commerce-vendors"])


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
    if isinstance(v, bool):
        return v
    if v is None:
        return None
    return str(v).strip() if isinstance(v, str) else v


def _bool_label(v) -> str:
    if v is None:
        return "—"
    return "Yes" if v else "No"


def _parse_vendor_ids(raw) -> list[str]:
    """clients.casinos.available_vendors is comma-separated VT-* keys."""
    if raw is None:
        return []
    text = str(raw).strip()
    if not text:
        return []
    return [part.strip() for part in text.split(",") if part.strip()]


def _available_vendor_names(raw) -> str | None:
    """Resolve available_vendors VT-* ids to vendors.vendors.vendor_name (order preserved)."""
    ids = _parse_vendor_ids(raw)
    if not ids:
        return None
    placeholders = ", ".join(["%s"] * len(ids))
    try:
        rows = _field_query(
            f"""
            SELECT reference_key, vendor_name
            FROM vendors.vendors
            WHERE reference_key IN ({placeholders})
            """,
            tuple(ids),
        )
    except Exception:
        return ", ".join(ids)
    by_id = {
        str(r.get("reference_key") or "").strip(): _json_value(r.get("vendor_name"))
        for r in rows
    }
    names = []
    for vid in ids:
        name = by_id.get(vid)
        names.append(name if name else vid)
    return ", ".join(names)


# --- Vendors ---


@vendors_router.get("/summary")
def vendors_summary():
    try:
        row = _field_query(
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN is_manufacturer = 1 THEN 1 ELSE 0 END) AS manufacturers,
                SUM(CASE WHEN logo_media_path IS NOT NULL AND logo_media_path <> '' THEN 1 ELSE 0 END) AS with_logo,
                (SELECT COUNT(*) FROM vendors.cabinets) AS cabinets
            FROM vendors.vendors
            """
        )[0]
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    return {
        "total": int(row["total"]),
        "manufacturers": int(row["manufacturers"] or 0),
        "with_logo": int(row["with_logo"] or 0),
        "cabinets": int(row["cabinets"] or 0),
    }


@vendors_router.get("")
def list_vendors(
    q: str = Query("", max_length=120),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    search = f"%{q.strip()}%" if q.strip() else None
    where = ""
    params: list = []
    if search:
        where = "WHERE v.vendor_name LIKE %s OR v.reference_key LIKE %s"
        params = [search, search]

    try:
        count_row = _field_query(
            f"SELECT COUNT(*) AS n FROM vendors.vendors AS v {where}",
            tuple(params) if params else None,
        )[0]
        total = int(count_row["n"])
        offset = (page - 1) * page_size
        rows = _field_query(
            f"""
            SELECT
                v.reference_key,
                v.vendor_name,
                v.is_manufacturer,
                v.logo_media_path,
                (SELECT COUNT(*) FROM vendors.cabinets c WHERE c.vendor_id = v.reference_key) AS cabinet_count,
                (SELECT COUNT(*) FROM vendors.themes t WHERE t.vendor_id = v.reference_key) AS theme_count
            FROM vendors.vendors AS v
            {where}
            ORDER BY v.vendor_name
            OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY
            """,
            tuple(params) if params else None,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    items = [
        {
            "reference_key": _json_value(r.get("reference_key")),
            "vendor_name": _json_value(r.get("vendor_name")),
            "is_manufacturer": bool(r.get("is_manufacturer")),
            "logo_media_path": _json_value(r.get("logo_media_path")),
            "cabinet_count": int(r.get("cabinet_count") or 0),
            "theme_count": int(r.get("theme_count") or 0),
        }
        for r in rows
    ]
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, math.ceil(total / page_size)) if total else 1,
    }


@vendors_router.get("/{reference_key}")
def vendor_detail(reference_key: str):
    vid = reference_key.strip()
    if not vid:
        raise HTTPException(status_code=400, detail="reference_key is required")

    try:
        rows = _field_query(
            """
            SELECT
                v.reference_key,
                v.vendor_name,
                v.is_manufacturer,
                v.logo_media_path,
                v.update_by,
                v.update_date
            FROM vendors.vendors AS v
            WHERE v.reference_key = %s
            """,
            (vid,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail=f"vendor not found: {vid!r}")

        r = rows[0]
        cabinets = _field_query(
            """
            SELECT TOP 50
                c.reference_key,
                c.cabinet_name,
                c.version_name,
                c.image_media_path,
                (SELECT COUNT(*) FROM vendors.themes t WHERE t.cabinet_id = c.reference_key) AS theme_count
            FROM vendors.cabinets AS c
            WHERE c.vendor_id = %s
            ORDER BY c.cabinet_name
            """,
            (vid,),
        )
        contract_count = _field_query(
            "SELECT COUNT(*) AS n FROM inventory.contract WHERE vendor_id = %s",
            (vid,),
        )[0]
        asset_count = _field_query(
            "SELECT COUNT(*) AS n FROM inventory.assets WHERE vendor_id = %s",
            (vid,),
        )[0]
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    return {
        "reference_key": _json_value(r.get("reference_key")),
        "vendor_name": _json_value(r.get("vendor_name")),
        "is_manufacturer": bool(r.get("is_manufacturer")),
        "logo_media_path": _json_value(r.get("logo_media_path")),
        "update_by": _json_value(r.get("update_by")),
        "update_date": _json_value(r.get("update_date")),
        "contract_count": int(contract_count.get("n") or 0),
        "asset_count": int(asset_count.get("n") or 0),
        "cabinets": [
            {
                "reference_key": _json_value(c.get("reference_key")),
                "cabinet_name": _json_value(c.get("cabinet_name")),
                "version_name": _json_value(c.get("version_name")),
                "image_media_path": _json_value(c.get("image_media_path")),
                "theme_count": int(c.get("theme_count") or 0),
            }
            for c in cabinets
        ],
    }


# --- Casinos ---

_PERF_VIEW = "[dashboard].[vw_performance_report]"

_CASINO_PERF_LATEST_CTE = f"""
WITH casino_perf AS (
    SELECT
        sm.casino_id,
        CONVERT(date, mr.[date]) AS performance_month,
        AVG(
            CASE
                WHEN mr.Days_on_Floor IS NOT NULL AND mr.Days_on_Floor > 0
                THEN CAST(mr.Coin_in AS float) / CAST(mr.Days_on_Floor AS float)
            END
        ) AS avg_cipd,
        AVG(CAST(mr.TDW AS float)) AS avg_tdw,
        AVG(CAST(mr.ADW AS float)) AS avg_adw,
        AVG(CAST(mr.WIN_Index AS float)) AS avg_win_index,
        AVG(CAST(mr.actual_index AS float)) AS avg_actual_index,
        SUM(CAST(mr.Commission AS float)) AS sum_commission,
        COUNT(*) AS performance_machines
    FROM {_PERF_VIEW} AS mr
    INNER JOIN inventory.slot_master_migration AS sm
        ON sm.reference_key = mr.slot_master_id
    WHERE mr.slot_master_id IS NOT NULL
      AND LTRIM(RTRIM(mr.slot_master_id)) <> N''
      AND mr.[date] IS NOT NULL
    GROUP BY sm.casino_id, CONVERT(date, mr.[date])
),
casino_perf_latest AS (
    SELECT cp.*
    FROM casino_perf AS cp
    INNER JOIN (
        SELECT casino_id, MAX(performance_month) AS performance_month
        FROM casino_perf
        GROUP BY casino_id
    ) AS latest
        ON latest.casino_id = cp.casino_id
       AND latest.performance_month = cp.performance_month
)
"""


def _performance_block(row) -> dict | None:
    if not row or row.get("performance_month") is None:
        return None
    return {
        "month": _json_value(row.get("performance_month")),
        "avg_cipd": _json_value(row.get("avg_cipd")),
        "avg_tdw": _json_value(row.get("avg_tdw")),
        "avg_adw": _json_value(row.get("avg_adw")),
        "avg_win_index": _json_value(row.get("avg_win_index")),
        "avg_actual_index": _json_value(row.get("avg_actual_index")),
        "sum_commission": _json_value(row.get("sum_commission")),
        "machine_count": int(row.get("performance_machines") or 0),
    }


def _location_label(row) -> str | None:
    parts = [
        str(row.get("address") or "").strip(),
        str(row.get("city") or "").strip(),
        " ".join(
            p
            for p in (
                str(row.get("state_abbreviation") or "").strip(),
                str(row.get("zip") or "").strip(),
            )
            if p
        ).strip(),
    ]
    cleaned = [p for p in parts if p]
    return ", ".join(cleaned) if cleaned else None


@casinos_router.get("/summary")
def casinos_summary():
    try:
        row = _field_query(
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN c.licensed = 1 THEN 1 ELSE 0 END) AS licensed,
                COUNT(DISTINCT COALESCE(c.state_id, t.state_id)) AS states,
                (SELECT COUNT(DISTINCT sm.casino_id)
                 FROM inventory.slot_master_migration AS sm
                 WHERE sm.is_active = 1) AS active_casinos
            FROM clients.casinos AS c
            LEFT JOIN clients.tribes AS t ON t.reference_key = c.tribe_id
            """
        )[0]
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    return {
        "total": int(row["total"]),
        "licensed": int(row["licensed"] or 0),
        "states": int(row["states"] or 0),
        "active_casinos": int(row["active_casinos"] or 0),
    }


@casinos_router.get("")
def list_casinos(
    q: str = Query("", max_length=120),
    state_id: str = Query("", max_length=25),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    clauses = []
    params: list = []
    if q.strip():
        clauses.append(
            "(cv.casino_name LIKE %s OR cv.casino_short LIKE %s OR cv.reference_key LIKE %s OR cv.tribe_name LIKE %s)"
        )
        s = f"%{q.strip()}%"
        params.extend([s, s, s, s])
    if state_id.strip():
        clauses.append("cv.state_id = %s")
        params.append(state_id.strip())

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    try:
        count_row = _field_query(
            f"SELECT COUNT(*) AS n FROM clients.casino_view AS cv {where}",
            tuple(params) if params else None,
        )[0]
        total = int(count_row["n"])
        offset = (page - 1) * page_size
        rows = _field_query(
            f"""
            {_CASINO_PERF_LATEST_CTE}
            SELECT
                cv.reference_key,
                cv.casino_name,
                cv.casino_short,
                cv.tribe_id,
                cv.tribe_name,
                cv.state_id,
                cv.state_abbreviation,
                c.emaint_property,
                c.sales,
                (SELECT COUNT(*)
                 FROM inventory.slot_master_migration sm
                 WHERE sm.casino_id = cv.reference_key AND sm.is_active = 1) AS active_machines,
                perf.performance_month,
                perf.avg_cipd,
                perf.avg_tdw,
                perf.avg_adw,
                perf.avg_win_index,
                perf.avg_actual_index,
                perf.sum_commission,
                perf.performance_machines
            FROM clients.casino_view AS cv
            INNER JOIN clients.casinos AS c ON c.reference_key = cv.reference_key
            LEFT JOIN casino_perf_latest AS perf ON perf.casino_id = cv.reference_key
            {where}
            ORDER BY cv.state_abbreviation, cv.casino_name
            OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY
            """,
            tuple(params) if params else None,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    items = []
    for r in rows:
        perf = _performance_block(r)
        last_report = perf.get("month") if perf else None
        items.append(
            {
                "reference_key": _json_value(r.get("reference_key")),
                "casino_name": _json_value(r.get("casino_name")),
                "casino_short": _json_value(r.get("casino_short")),
                "tribe_id": _json_value(r.get("tribe_id")),
                "tribe_name": _json_value(r.get("tribe_name")),
                "state_id": _json_value(r.get("state_id")),
                "state_abbreviation": _json_value(r.get("state_abbreviation")),
                "emaint_property": _json_value(r.get("emaint_property")),
                "sales": _json_value(r.get("sales")),
                "active_machines": int(r.get("active_machines") or 0),
                "last_report": last_report,
                "performance": perf,
                "cipd": perf.get("avg_cipd") if perf else None,
                "tdw": perf.get("avg_tdw") if perf else None,
                "avg_adw": perf.get("avg_adw") if perf else None,
                "win_index": perf.get("avg_win_index") if perf else None,
                "actual_index": perf.get("avg_actual_index") if perf else None,
            }
        )
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, math.ceil(total / page_size)) if total else 1,
    }


@casinos_router.get("/{reference_key}")
def casino_detail(reference_key: str):
    cid = reference_key.strip()
    if not cid:
        raise HTTPException(status_code=400, detail="reference_key is required")

    try:
        rows = _field_query(
            f"""
            {_CASINO_PERF_LATEST_CTE}
            SELECT
                c.reference_key,
                c.casino_name,
                c.legal_title,
                c.casino_short,
                c.casino_abbreviation,
                c.tribe_id,
                t.tribe_name,
                COALESCE(c.state_id, t.state_id) AS state_id,
                s.state,
                s.state_abbreviation,
                c.sales,
                c.licensed,
                c.available_vendors,
                c.signed_master_agreement,
                c.executed_on,
                c.expiration,
                c.agreement_type,
                c.emaint_property,
                c.main_house_average,
                c.smoking_adw,
                c.high_limit_adw,
                c.total_number_of_machines,
                c.loss_passed,
                c.general_manager_name,
                c.general_manager_email,
                c.slot_director_name,
                c.slot_director_email,
                c.accounting_name,
                c.accounting_email,
                c.address,
                c.city,
                c.zip,
                c.latitude,
                c.longitude,
                c.update_by,
                c.update_date,
                perf.performance_month,
                perf.avg_cipd,
                perf.avg_tdw,
                perf.avg_adw,
                perf.avg_win_index,
                perf.avg_actual_index,
                perf.sum_commission,
                perf.performance_machines
            FROM clients.casinos AS c
            LEFT JOIN clients.tribes AS t ON t.reference_key = c.tribe_id
            LEFT JOIN clients.states AS s ON s.reference_key = COALESCE(c.state_id, t.state_id)
            LEFT JOIN casino_perf_latest AS perf ON perf.casino_id = c.reference_key
            WHERE c.reference_key = %s
            """,
            (cid,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail=f"casino not found: {cid!r}")

        r = rows[0]
        active_machines = _field_query(
            """
            SELECT COUNT(*) AS n
            FROM inventory.slot_master_migration
            WHERE casino_id = %s AND is_active = 1
            """,
            (cid,),
        )[0]
        project_count = _field_query(
            "SELECT COUNT(*) AS n FROM projects.ims WHERE casino_id = %s",
            (cid,),
        )[0]
        catalog_count = _field_query(
            "SELECT COUNT(*) AS n FROM projects.project_catalog WHERE casino_id = %s",
            (cid,),
        )[0]
        ims_preview_rows = _field_query(
            """
            SELECT TOP 10
                ims.reference_key,
                ims.project_number,
                ims.start_date,
                ims.end_date,
                ims.status,
                ims.project_type,
                ims.description,
                pc.reference_key AS catalog_reference_key,
                pc.project_name AS catalog_project_name,
                pc.notes AS catalog_notes,
                (
                    SELECT COUNT(*)
                    FROM projects.project_details pd
                    WHERE pd.project_id = pc.reference_key
                ) AS catalog_line_count
            FROM projects.ims AS ims
            LEFT JOIN projects.project_catalog AS pc ON pc.ims_id = ims.reference_key
            WHERE ims.casino_id = %s
            ORDER BY COALESCE(ims.start_date, '1900-01-01') DESC, ims.project_number DESC
            """,
            (cid,),
        )
        sister_rows = []
        tribe_id = _json_value(r.get("tribe_id"))
        if tribe_id:
            sister_rows = _field_query(
                """
                SELECT
                    c.reference_key,
                    c.casino_name,
                    c.casino_short,
                    s.state_abbreviation,
                    (
                        SELECT COUNT(*)
                        FROM inventory.slot_master_migration sm
                        WHERE sm.casino_id = c.reference_key AND sm.is_active = 1
                    ) AS active_machines
                FROM clients.casinos AS c
                LEFT JOIN clients.tribes AS t ON t.reference_key = c.tribe_id
                LEFT JOIN clients.states AS s ON s.reference_key = COALESCE(c.state_id, t.state_id)
                WHERE c.tribe_id = %s
                  AND c.reference_key <> %s
                ORDER BY s.state_abbreviation, c.casino_name
                """,
                (tribe_id, cid),
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    lat = _json_value(r.get("latitude"))
    lon = _json_value(r.get("longitude"))
    has_map = lat is not None and lon is not None
    location_label = _location_label(r)
    performance = _performance_block(r)
    active_n = int(active_machines.get("n") or 0)
    total_floor = r.get("total_number_of_machines")
    try:
        total_floor_n = int(total_floor) if total_floor is not None else 0
    except (TypeError, ValueError):
        total_floor_n = 0
    dgs_floor_percent = (
        round((active_n / total_floor_n) * 100, 1) if total_floor_n > 0 else None
    )

    ims_projects = []
    for p in ims_preview_rows:
        catalog_key = _json_value(p.get("catalog_reference_key"))
        ims_projects.append(
            {
                "reference_key": _json_value(p.get("reference_key")),
                "project_no": _json_value(p.get("project_number")),
                "date_start": _json_value(p.get("start_date")),
                "date_end": _json_value(p.get("end_date")),
                "status": _json_value(p.get("status")),
                "proj_type": _json_value(p.get("project_type")),
                "proj_desc": _json_value(p.get("description")),
                "matching_catalog": (
                    {
                        "reference_key": catalog_key,
                        "project_name": _json_value(p.get("catalog_project_name")),
                        "line_count": int(p.get("catalog_line_count") or 0),
                        "notes": _json_value(p.get("catalog_notes")),
                    }
                    if catalog_key
                    else None
                ),
            }
        )

    return {
        "reference_key": _json_value(r.get("reference_key")),
        "casino_name": _json_value(r.get("casino_name")),
        "legal_title": _json_value(r.get("legal_title")),
        "casino_short": _json_value(r.get("casino_short")),
        "casino_abbreviation": _json_value(r.get("casino_abbreviation")),
        "tribe_id": _json_value(r.get("tribe_id")),
        "tribe_name": _json_value(r.get("tribe_name")),
        "state_id": _json_value(r.get("state_id")),
        "state": _json_value(r.get("state")),
        "state_abbreviation": _json_value(r.get("state_abbreviation")),
        "address": _json_value(r.get("address")),
        "city": _json_value(r.get("city")),
        "zip": _json_value(r.get("zip")),
        "location_label": location_label,
        "latitude": lat,
        "longitude": lon,
        "has_map": has_map,
        "sales": _json_value(r.get("sales")),
        "available_vendors": _available_vendor_names(r.get("available_vendors")),
        "licensed": _bool_label(r.get("licensed")),
        "signed_master_agreement": _bool_label(r.get("signed_master_agreement")),
        "executed_on": _json_value(r.get("executed_on")),
        "expiration": _json_value(r.get("expiration")),
        "agreement_type": _json_value(r.get("agreement_type")),
        "emaint_property": _json_value(r.get("emaint_property")),
        "main_house_average": _json_value(r.get("main_house_average")),
        "smoking_adw": _json_value(r.get("smoking_adw")),
        "high_limit_adw": _json_value(r.get("high_limit_adw")),
        "total_number_of_machines": _json_value(r.get("total_number_of_machines")),
        "loss_passed": _bool_label(r.get("loss_passed")),
        "general_manager_name": _json_value(r.get("general_manager_name")),
        "general_manager_email": _json_value(r.get("general_manager_email")),
        "slot_director_name": _json_value(r.get("slot_director_name")),
        "slot_director_email": _json_value(r.get("slot_director_email")),
        "accounting_name": _json_value(r.get("accounting_name")),
        "accounting_email": _json_value(r.get("accounting_email")),
        "update_by": _json_value(r.get("update_by")),
        "update_date": _json_value(r.get("update_date")),
        "active_machines": active_n,
        "dgs_floor_percent": dgs_floor_percent,
        "project_count": int(project_count.get("n") or 0),
        "catalog_count": int(catalog_count.get("n") or 0),
        "ims_projects": ims_projects,
        "sister_casinos": [
            {
                "reference_key": _json_value(s.get("reference_key")),
                "casino_name": _json_value(s.get("casino_name")),
                "casino_short": _json_value(s.get("casino_short")),
                "state_abbreviation": _json_value(s.get("state_abbreviation")),
                "active_machines": int(s.get("active_machines") or 0),
            }
            for s in sister_rows
        ],
        "performance": performance,
    }
