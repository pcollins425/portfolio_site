"""Capacity dashboard — machine downtime and part cost for Ops / Finance management."""

from __future__ import annotations

import html
import os
import re
from calendar import monthrange
from datetime import date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app import mssql
from app import permission_catalog as cat
from app.auth_deps import require_area_read, require_demo_user
from app.casino_month_matrix import _ABBREV, _STATE_REGION

router = APIRouter(
    prefix="/api/capacity-dashboard",
    tags=["capacity-dashboard"],
    dependencies=[Depends(require_area_read(cat.CAPACITY_DASHBOARD_AREA))],
)

_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")

_INCLUDE = """
    (
      ISNULL(wo.hours, 0) > 0
      OR wo.downstart IS NOT NULL
      OR wo.downend IS NOT NULL
    )
"""

_BUCKET = "COALESCE(wo.downstart, wo.date_wo)"


def _catalog() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _query(sql: str, params=None) -> list[dict]:
    return mssql.query(sql, params=params, database=_catalog(), profile="field", load_env=False)


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = html.unescape(str(value).strip())
    return text or None


def _day(value: Any) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if value is None:
        return None
    return str(value)[:10]


def _num(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _parse_month(month: str | None) -> tuple[str, date, date]:
    today = date.today()
    raw = (month or "").strip() or today.strftime("%Y-%m")
    if not _MONTH_RE.match(raw):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    year, mon = int(raw[:4]), int(raw[5:7])
    if mon < 1 or mon > 12:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM")
    start = date(year, mon, 1)
    end = date(year, mon, monthrange(year, mon)[1])
    return raw, start, end


def _region_case_sql(expr: str = "st.state") -> str:
    whens = [f"WHEN N'{name}' THEN N'{region}'" for name, region in _STATE_REGION.items()]
    for abbr, full in _ABBREV.items():
        whens.append(f"WHEN N'{abbr}' THEN N'{_STATE_REGION[full.lower()]}'")
    return f"CASE LOWER(RTRIM({expr})) " + " ".join(whens) + " ELSE N'Unassigned' END"


def _ranked(rows: list[dict], *, limit: int = 25) -> list[dict]:
    out = []
    for row in rows[:limit]:
        key = _text(row.get("dim_key")) or "Unassigned"
        label = _text(row.get("dim_label")) or key
        out.append(
            {
                "key": key,
                "label": label,
                "downtime": round(_num(row.get("downtime")), 2),
                "wo_count": int(row.get("wo_count") or 0),
                "asset_count": int(row.get("asset_count") or 0),
            }
        )
    return out


def _base_joins() -> str:
    return f"""
        FROM projects.work_orders AS wo
        LEFT JOIN clients.casinos AS cas ON cas.reference_key = wo.casino_id
        LEFT JOIN clients.states AS st ON st.reference_key = cas.state_id
        LEFT JOIN inventory.assets AS ast ON ast.reference_key = wo.asset_id
        LEFT JOIN vendors.vendors AS ven ON ven.reference_key = ast.vendor_id
        LEFT JOIN vendors.cabinets AS cab ON cab.reference_key = ast.cabinet_id
        LEFT JOIN vendors.themes AS th ON th.reference_key = wo.theme_id
    """


@router.get("")
def capacity_dashboard(
    month: Annotated[str | None, Query()] = None,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    del user
    month_key, start, end = _parse_month(month)
    region_sql = _region_case_sql()

    kpi_rows = _query(
        f"""
        SELECT
            ISNULL(SUM(CAST(wo.hours AS float)), 0) AS downtime,
            COUNT(*) AS wo_count,
            COUNT(DISTINCT COALESCE(NULLIF(LTRIM(RTRIM(wo.asset_id)), N''), wo.compid)) AS asset_count,
            AVG(CAST(NULLIF(wo.hours, 0) AS float)) AS avg_downtime
        {_base_joins()}
        WHERE {_INCLUDE}
          AND {_BUCKET} >= %s
          AND {_BUCKET} < DATEADD(day, 1, %s)
        """,
        (start, end),
    )
    part_kpi = _query(
        f"""
        SELECT ISNULL(SUM(CAST(mat.ext_cost AS float)), 0) AS part_cost
        FROM projects.work_order_material AS mat
        INNER JOIN projects.work_orders AS wo ON wo.wo = mat.wo
        WHERE {_INCLUDE}
          AND {_BUCKET} >= %s
          AND {_BUCKET} < DATEADD(day, 1, %s)
        """,
        (start, end),
    )
    kpi = kpi_rows[0] if kpi_rows else {}
    downtime = _num(kpi.get("downtime"))
    wo_count = int(kpi.get("wo_count") or 0)
    avg = _num(kpi.get("avg_downtime")) if wo_count else 0.0

    trend_rows = _query(
        f"""
        SELECT
            CONVERT(char(7), {_BUCKET}, 126) AS month_key,
            ISNULL(SUM(CAST(wo.hours AS float)), 0) AS downtime,
            COUNT(*) AS wo_count
        FROM projects.work_orders AS wo
        WHERE {_INCLUDE}
          AND {_BUCKET} >= DATEADD(month, -11, %s)
          AND {_BUCKET} < DATEADD(day, 1, %s)
        GROUP BY CONVERT(char(7), {_BUCKET}, 126)
        ORDER BY month_key
        """,
        (start, end),
    )
    trend = [
        {
            "month": _text(row.get("month_key")),
            "downtime": round(_num(row.get("downtime")), 2),
            "wo_count": int(row.get("wo_count") or 0),
        }
        for row in trend_rows
    ]

    def breakout(dim_key_sql: str, dim_label_sql: str) -> list[dict]:
        rows = _query(
            f"""
            SELECT
                {dim_key_sql} AS dim_key,
                {dim_label_sql} AS dim_label,
                ISNULL(SUM(CAST(wo.hours AS float)), 0) AS downtime,
                COUNT(*) AS wo_count,
                COUNT(DISTINCT COALESCE(NULLIF(LTRIM(RTRIM(wo.asset_id)), N''), wo.compid)) AS asset_count
            {_base_joins()}
            WHERE {_INCLUDE}
              AND {_BUCKET} >= %s
              AND {_BUCKET} < DATEADD(day, 1, %s)
            GROUP BY {dim_key_sql}, {dim_label_sql}
            ORDER BY downtime DESC, wo_count DESC
            """,
            (start, end),
        )
        return _ranked(rows)

    geo = {
        "region": breakout(region_sql, region_sql),
        "state": breakout(
            "COALESCE(NULLIF(LTRIM(RTRIM(st.reference_key)), N''), N'Unassigned')",
            "COALESCE(NULLIF(LTRIM(RTRIM(st.state)), N''), N'Unassigned')",
        ),
        "casino": breakout(
            "COALESCE(NULLIF(LTRIM(RTRIM(wo.casino_id)), N''), N'Unassigned')",
            "COALESCE(NULLIF(LTRIM(RTRIM(cas.casino_short)), N''), NULLIF(LTRIM(RTRIM(cas.casino_name)), N''), NULLIF(LTRIM(RTRIM(wo.property)), N''), N'Unassigned')",
        ),
    }
    product = {
        "vendor": breakout(
            "COALESCE(NULLIF(LTRIM(RTRIM(ast.vendor_id)), N''), N'Unassigned')",
            "COALESCE(NULLIF(LTRIM(RTRIM(ven.vendor_name)), N''), N'Unassigned')",
        ),
        "cabinet": breakout(
            "COALESCE(NULLIF(LTRIM(RTRIM(ast.cabinet_id)), N''), N'Unassigned')",
            "COALESCE(NULLIF(LTRIM(RTRIM(cab.cabinet_name)), N''), N'Unassigned')",
        ),
        "theme": breakout(
            "COALESCE(NULLIF(LTRIM(RTRIM(wo.theme_id)), N''), N'Unassigned')",
            "COALESCE(NULLIF(LTRIM(RTRIM(th.theme_name)), N''), NULLIF(LTRIM(RTRIM(wo.comp_desc)), N''), N'Unassigned')",
        ),
    }

    part_rows = _query(
        f"""
        SELECT
            COALESCE(NULLIF(LTRIM(RTRIM(wo.casino_id)), N''), N'Unassigned') AS dim_key,
            COALESCE(
                NULLIF(LTRIM(RTRIM(cas.casino_short)), N''),
                NULLIF(LTRIM(RTRIM(cas.casino_name)), N''),
                NULLIF(LTRIM(RTRIM(wo.property)), N''),
                N'Unassigned'
            ) AS dim_label,
            ISNULL(SUM(CAST(mat.ext_cost AS float)), 0) AS part_cost,
            COUNT(*) AS line_count
        FROM projects.work_order_material AS mat
        INNER JOIN projects.work_orders AS wo ON wo.wo = mat.wo
        LEFT JOIN clients.casinos AS cas ON cas.reference_key = wo.casino_id
        WHERE {_INCLUDE}
          AND {_BUCKET} >= %s
          AND {_BUCKET} < DATEADD(day, 1, %s)
        GROUP BY
            COALESCE(NULLIF(LTRIM(RTRIM(wo.casino_id)), N''), N'Unassigned'),
            COALESCE(
                NULLIF(LTRIM(RTRIM(cas.casino_short)), N''),
                NULLIF(LTRIM(RTRIM(cas.casino_name)), N''),
                NULLIF(LTRIM(RTRIM(wo.property)), N''),
                N'Unassigned'
            )
        ORDER BY part_cost DESC, line_count DESC
        """,
        (start, end),
    )
    part_costs = [
        {
            "key": _text(row.get("dim_key")) or "Unassigned",
            "label": _text(row.get("dim_label")) or "Unassigned",
            "part_cost": round(_num(row.get("part_cost")), 2),
            "line_count": int(row.get("line_count") or 0),
        }
        for row in part_rows[:40]
    ]

    return {
        "month": month_key,
        "month_start": start.isoformat(),
        "month_end": end.isoformat(),
        "bucket_rule": "Full downtime hours attributed to the month of COALESCE(downstart, date_wo).",
        "kpis": {
            "downtime": round(downtime, 2),
            "wo_count": wo_count,
            "asset_count": int(kpi.get("asset_count") or 0),
            "avg_downtime": round(avg, 2),
            "part_cost": round(_num(part_kpi[0].get("part_cost") if part_kpi else 0), 2),
        },
        "trend": trend,
        "geo": geo,
        "product": product,
        "part_costs": part_costs,
    }


_DRILL_DIMS = frozenset({"region", "state", "casino", "vendor", "cabinet", "theme"})


@router.get("/drill")
def capacity_drill(
    month: Annotated[str | None, Query()] = None,
    dim: Annotated[str, Query()] = "",
    key: Annotated[str, Query()] = "",
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    del user
    month_key, start, end = _parse_month(month)
    dim = (dim or "").strip().lower()
    key = (key or "").strip() or "Unassigned"
    if dim not in _DRILL_DIMS:
        raise HTTPException(status_code=400, detail="dim must be region, state, casino, vendor, cabinet, or theme")

    region_sql = _region_case_sql()
    filters = {
        "region": region_sql,
        "state": "COALESCE(NULLIF(LTRIM(RTRIM(st.reference_key)), N''), N'Unassigned')",
        "casino": "COALESCE(NULLIF(LTRIM(RTRIM(wo.casino_id)), N''), N'Unassigned')",
        "vendor": "COALESCE(NULLIF(LTRIM(RTRIM(ast.vendor_id)), N''), N'Unassigned')",
        "cabinet": "COALESCE(NULLIF(LTRIM(RTRIM(ast.cabinet_id)), N''), N'Unassigned')",
        "theme": "COALESCE(NULLIF(LTRIM(RTRIM(wo.theme_id)), N''), N'Unassigned')",
    }
    rows = _query(
        f"""
        SELECT TOP 300
            wo.wo,
            wo.date_wo,
            wo.hours,
            wo.downstart,
            wo.downend,
            wo.property,
            wo.casino_id,
            wo.asset_id,
            wo.theme_id,
            ast.vendor_id,
            ast.cabinet_id,
            COALESCE(ast.serial_number, wo.compid) AS serial,
            ven.vendor_name,
            cab.cabinet_name,
            COALESCE(th.theme_name, wo.comp_desc) AS theme_name,
            cas.casino_short,
            cas.casino_name
        {_base_joins()}
        WHERE {_INCLUDE}
          AND {_BUCKET} >= %s
          AND {_BUCKET} < DATEADD(day, 1, %s)
          AND {filters[dim]} = %s
        ORDER BY ISNULL(wo.hours, 0) DESC, wo.downstart DESC, wo.wo DESC
        """,
        (start, end, key),
    )
    return {
        "month": month_key,
        "dim": dim,
        "key": key,
        "orders": [
            {
                "wo": _text(row.get("wo")),
                "date_wo": _day(row.get("date_wo")),
                "hours": round(_num(row.get("hours")), 2) if row.get("hours") is not None else None,
                "downstart": _day(row.get("downstart")),
                "downend": _day(row.get("downend")),
                "property": _text(row.get("casino_short") or row.get("casino_name") or row.get("property")),
                "casino_id": _text(row.get("casino_id")),
                "asset_id": _text(row.get("asset_id")),
                "theme_id": _text(row.get("theme_id")),
                "vendor_id": _text(row.get("vendor_id")),
                "cabinet_id": _text(row.get("cabinet_id")),
                "serial": _text(row.get("serial")),
                "vendor": _text(row.get("vendor_name")),
                "cabinet": _text(row.get("cabinet_name")),
                "theme": _text(row.get("theme_name")),
            }
            for row in rows
        ],
    }
