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
deals_router = APIRouter(prefix="/api/commerce/deals", tags=["commerce-deals"])


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


def _iso_dt(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return _json_value(v)


def _as_bool(v) -> bool:
    if v is None:
        return False
    if isinstance(v, bool):
        return v
    try:
        return bool(int(v))
    except (TypeError, ValueError):
        return bool(v)


def _person_name(first, last) -> str | None:
    parts = [str(p).strip() for p in (first, last) if p and str(p).strip()]
    return " ".join(parts) if parts else None


def _hubspot_for_casino(casino_id: str) -> dict:
    """Read-only HubSpot landing for Commerce casino detail (no live HubSpot calls)."""
    empty = {
        "linked": False,
        "synced_at": None,
        "company": None,
        "contacts": [],
        "deals": [],
    }
    company_rows = _field_query(
        """
        SELECT TOP 1
            co.hubspot_company_id,
            co.name,
            co.domain,
            co.phone,
            co.lifecycle_stage,
            co.synced_at,
            LTRIM(RTRIM(CONCAT(
                ISNULL(o.first_name, N''),
                N' ',
                ISNULL(o.last_name, N'')
            ))) AS owner_name
        FROM clients.hubspot_company_casino AS j
        INNER JOIN clients.hubspot_company AS co
            ON co.hubspot_company_id = j.hubspot_company_id
        LEFT JOIN clients.hubspot_owner AS o
            ON o.hubspot_owner_id = co.hubspot_owner_id
        WHERE j.casino_id = %s
        ORDER BY co.synced_at DESC
        """,
        (casino_id,),
    )
    if not company_rows:
        return empty

    co = company_rows[0]
    owner = _json_value(co.get("owner_name"))
    company = {
        "name": _json_value(co.get("name")),
        "domain": _json_value(co.get("domain")),
        "phone": _json_value(co.get("phone")),
        "lifecycle_stage": _json_value(co.get("lifecycle_stage")),
        "owner_name": owner or None,
    }

    contact_rows = _field_query(
        """
        SELECT
            first_name,
            last_name,
            email,
            phone,
            job_title
        FROM clients.vw_hubspot_casino_contacts
        WHERE casino_id = %s
        ORDER BY
            CASE WHEN NULLIF(LTRIM(RTRIM(job_title)), N'') IS NULL THEN 1 ELSE 0 END,
            last_name,
            first_name
        """,
        (casino_id,),
    )
    contacts = [
        {
            "name": _person_name(row.get("first_name"), row.get("last_name")),
            "job_title": _json_value(row.get("job_title")),
            "email": _json_value(row.get("email")),
            "phone": _json_value(row.get("phone")),
        }
        for row in contact_rows
    ]

    deal_rows = _field_query(
        """
        SELECT
            hubspot_deal_id,
            deal_key,
            deal_name,
            deal_stage,
            amount,
            close_date,
            ims_id,
            is_closed,
            is_closed_won
        FROM clients.vw_hubspot_casino_deals
        WHERE casino_id = %s
        ORDER BY
            CASE WHEN ISNULL(is_closed, 0) = 0 THEN 0 ELSE 1 END,
            close_date DESC,
            deal_name
        """,
        (casino_id,),
    )
    deals = [
        {
            "hubspot_deal_id": _json_value(row.get("hubspot_deal_id")),
            "deal_key": _json_value(row.get("deal_key")),
            "deal_name": _json_value(row.get("deal_name")),
            "deal_stage": _json_value(row.get("deal_stage")),
            "amount": _json_value(row.get("amount")),
            "close_date": _json_value(row.get("close_date")),
            "ims_id": _json_value(row.get("ims_id")),
            "is_closed": _as_bool(row.get("is_closed")),
            "is_closed_won": _as_bool(row.get("is_closed_won")),
        }
        for row in deal_rows
    ]

    return {
        "linked": True,
        "synced_at": _iso_dt(co.get("synced_at")),
        "company": company,
        "contacts": contacts,
        "deals": deals,
    }


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
        AVG(CAST(mr.ADW AS float)) AS avg_adw,
        AVG(CAST(mr.WIN_Index AS float)) AS avg_win_index,
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
        "avg_adw": _json_value(row.get("avg_adw")),
        "avg_win_index": _json_value(row.get("avg_win_index")),
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
                perf.avg_adw,
                perf.avg_win_index,
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
                "performance": perf,
                "avg_adw": perf.get("avg_adw") if perf else None,
                "win_index": perf.get("avg_win_index") if perf else None,
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
                perf.avg_adw,
                perf.avg_win_index,
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
        hubspot = _hubspot_for_casino(cid)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    lat = _json_value(r.get("latitude"))
    lon = _json_value(r.get("longitude"))
    has_map = lat is not None and lon is not None
    location_label = _location_label(r)
    performance = _performance_block(r)

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
        "active_machines": int(active_machines.get("n") or 0),
        "project_count": int(project_count.get("n") or 0),
        "performance": performance,
        "hubspot": hubspot,
    }

# --- HubSpot deals (Commerce board / catalog) ---


def _deal_row(r: dict) -> dict:
    return {
        "hubspot_deal_id": _json_value(r.get("hubspot_deal_id")),
        "deal_key": _json_value(r.get("deal_key") or r.get("reference_key")),
        "deal_name": _json_value(r.get("deal_name")),
        "pipeline": _json_value(r.get("pipeline")),
        "deal_stage": _json_value(r.get("deal_stage")),
        "amount": _json_value(r.get("amount")),
        "close_date": _json_value(r.get("close_date")),
        "create_date": _json_value(r.get("create_date")),
        "project_date": _json_value(r.get("project_date")),
        "sales_order": _json_value(r.get("sales_order")),
        "product_units": _json_value(r.get("product_units")),
        "payout_type": _json_value(r.get("payout_type")),
        "ims_id": _json_value(r.get("ims_id")),
        "casino_id": _json_value(r.get("casino_id")),
        "casino_name": _json_value(r.get("casino_name")),
        "owner_name": _json_value(r.get("owner_name")),
        "is_closed": _as_bool(r.get("is_closed")),
        "is_closed_won": _as_bool(r.get("is_closed_won")),
        "synced_at": _iso_dt(r.get("synced_at")),
    }


_DEAL_LIST_SELECT = """
SELECT
    d.hubspot_deal_id,
    d.reference_key AS deal_key,
    d.deal_name,
    d.pipeline,
    d.deal_stage,
    d.amount,
    d.close_date,
    d.create_date,
    d.project_date,
    d.sales_order,
    d.product_units,
    d.payout_type,
    d.ims_id,
    d.casino_id,
    d.is_closed,
    d.is_closed_won,
    d.synced_at,
    c.casino_name,
    LTRIM(RTRIM(CONCAT(ISNULL(o.first_name, N''), N' ', ISNULL(o.last_name, N'')))) AS owner_name
FROM clients.hubspot_deal AS d
LEFT JOIN clients.casinos AS c ON c.reference_key = d.casino_id
LEFT JOIN clients.hubspot_owner AS o ON o.hubspot_owner_id = d.hubspot_owner_id
"""


@deals_router.get("/summary")
def deals_summary():
    try:
        row = _field_query(
            """
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN ISNULL(is_closed, 0) = 0 THEN 1 ELSE 0 END) AS open_count,
                SUM(CASE WHEN ISNULL(is_closed, 0) = 1 THEN 1 ELSE 0 END) AS closed_count,
                SUM(CASE WHEN ISNULL(is_closed_won, 0) = 1 THEN 1 ELSE 0 END) AS won_count,
                SUM(CASE WHEN ISNULL(is_closed, 0) = 0 THEN ISNULL(amount, 0) ELSE 0 END) AS open_amount,
                COUNT(DISTINCT NULLIF(deal_stage, N'')) AS stage_count,
                MAX(synced_at) AS last_sync
            FROM clients.hubspot_deal
            """
        )[0]
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    return {
        "total": int(row.get("total") or 0),
        "open_count": int(row.get("open_count") or 0),
        "closed_count": int(row.get("closed_count") or 0),
        "won_count": int(row.get("won_count") or 0),
        "open_amount": _json_value(row.get("open_amount")),
        "stage_count": int(row.get("stage_count") or 0),
        "last_sync": _json_value(row.get("last_sync")),
    }


@deals_router.get("")
def list_deals(
    q: str = Query("", max_length=120),
    status: str = Query("open", description="open|closed|all|won"),
    pipeline: str = Query("", max_length=50),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
):
    status_n = (status or "open").strip().lower()
    where = ["1=1"]
    params: list = []
    if status_n == "open":
        where.append("ISNULL(d.is_closed, 0) = 0")
    elif status_n == "closed":
        where.append("ISNULL(d.is_closed, 0) = 1")
    elif status_n == "won":
        where.append("ISNULL(d.is_closed_won, 0) = 1")
    # all = no filter

    pipe = (pipeline or "").strip()
    if pipe:
        where.append("d.pipeline = %s")
        params.append(pipe)

    needle = (q or "").strip()
    if needle:
        where.append(
            """(
                d.deal_name LIKE %s OR d.reference_key LIKE %s
                OR c.casino_name LIKE %s OR d.casino_id LIKE %s
                OR d.deal_stage LIKE %s OR d.sales_order LIKE %s
            )"""
        )
        like = f"%{needle}%"
        params.extend([like, like, like, like, like, like])

    where_sql = " AND ".join(where)
    try:
        total = int(
            _field_query(
                f"""
                SELECT COUNT(*) AS n
                FROM clients.hubspot_deal AS d
                LEFT JOIN clients.casinos AS c ON c.reference_key = d.casino_id
                WHERE {where_sql}
                """,
                tuple(params),
            )[0]["n"]
            or 0
        )
        offset = (page - 1) * page_size
        rows = _field_query(
            f"""
            {_DEAL_LIST_SELECT}
            WHERE {where_sql}
            ORDER BY
                CASE WHEN ISNULL(d.is_closed, 0) = 0 THEN 0 ELSE 1 END,
                d.deal_stage,
                d.close_date DESC,
                d.deal_name
            OFFSET %s ROWS FETCH NEXT %s ROWS ONLY
            """,
            tuple(params + [offset, page_size]),
        )
        stage_rows = _field_query(
            f"""
            SELECT
                ISNULL(NULLIF(LTRIM(RTRIM(d.deal_stage)), N''), N'(no stage)') AS deal_stage,
                COUNT(*) AS n
            FROM clients.hubspot_deal AS d
            LEFT JOIN clients.casinos AS c ON c.reference_key = d.casino_id
            WHERE {where_sql}
            GROUP BY ISNULL(NULLIF(LTRIM(RTRIM(d.deal_stage)), N''), N'(no stage)')
            ORDER BY n DESC, deal_stage
            """,
            tuple(params),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    return {
        "items": [_deal_row(r) for r in rows],
        "stages": [
            {"deal_stage": _json_value(s.get("deal_stage")), "count": int(s.get("n") or 0)}
            for s in stage_rows
        ],
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": max(1, math.ceil(total / page_size)) if page_size else 1,
        "status": status_n,
    }


@deals_router.get("/{deal_id}")
def get_deal(deal_id: str):
    hid = (deal_id or "").strip()
    if not hid:
        raise HTTPException(status_code=400, detail="deal id required")
    try:
        # Accept hubspot_deal_id or HSD- reference_key
        if hid.upper().startswith("HSD-"):
            rows = _field_query(
                f"{_DEAL_LIST_SELECT} WHERE d.reference_key = %s",
                (hid,),
            )
        else:
            rows = _field_query(
                f"{_DEAL_LIST_SELECT} WHERE d.hubspot_deal_id = %s",
                (int(hid),),
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="deal id must be numeric or HSD-…") from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    if not rows:
        raise HTTPException(status_code=404, detail="Deal not found")
    return _deal_row(rows[0])
