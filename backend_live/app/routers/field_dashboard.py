"""Field dashboard — upcoming projects and open work orders.

A Technician sees the projects on their route or named on the job, and the
work orders assigned to them. Any other role with the grant sees every row.
"""

from __future__ import annotations

import html
import os
from datetime import date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app import mssql
from app import permission_catalog as cat
from app.auth_deps import require_area_read, require_demo_user
from app.casino_scope import assigned_employee_id, columns_contain_any
from app.routers import projects as project_routes

router = APIRouter(
    prefix="/api/field-dashboard",
    tags=["field-dashboard"],
    dependencies=[Depends(require_area_read(cat.TECH_DASHBOARD_AREA))],
)

_OPEN_WO = """
    wo.workstatus = N'O'
    AND ISNULL(wo.stattype, N'') NOT IN (N'Completed', N'Cancelled')
"""


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


@router.get("")
def field_dashboard(
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    mine = assigned_employee_id(user) is not None
    project_sql, project_params = project_routes._house_or_named(
        user,
        "casinos",
        ["ims.lead_tech", "ims.assistant_techs"],
    )
    projects = _query(
        f"""
        SELECT TOP 200
            CAST(ims.project_number AS nvarchar(50)) AS project_number,
            ims.start_date,
            ims.description,
            casinos.casino_name
        FROM projects.ims AS ims
        LEFT JOIN clients.casinos AS casinos ON casinos.reference_key = ims.casino_id
        WHERE ims.status = N'Open'
          AND COALESCE(ims.end_date, ims.start_date) >= CAST(GETDATE() AS date)
        {project_sql}
        ORDER BY ims.start_date, ims.project_number
        """,
        project_params or None,
    )
    wo_sql = ""
    wo_params: tuple = ()
    if mine:
        wo_sql, wo_params = columns_contain_any(
            ["wo.assignto"],
            project_routes._project_needles(user),
        )
        wo_sql = " AND " + wo_sql
    work_orders = _query(
        f"""
        SELECT TOP 400
            wo.wo,
            wo.date_wo,
            wo.property,
            wo.compid,
            wo.brief_desc,
            ven.vendor_name,
            cab.cabinet_name,
            th.theme_name
        FROM projects.work_orders AS wo
        LEFT JOIN inventory.compinfo_landing AS comp ON comp.compid = wo.compid
        LEFT JOIN vendors.vendors AS ven ON ven.reference_key = comp.vendor_id
        LEFT JOIN vendors.cabinets AS cab ON cab.reference_key = comp.cabinet_id
        LEFT JOIN vendors.themes AS th ON th.reference_key = comp.theme_id
        WHERE {_OPEN_WO}
        {wo_sql}
        ORDER BY wo.date_wo DESC, wo.wo DESC
        """,
        wo_params or None,
    )
    return {
        "scope": "mine" if mine else "all",
        "projects": [
            {
                "project_number": _text(row.get("project_number")),
                "start_date": _day(row.get("start_date")),
                "description": _text(row.get("description")),
                "property": _text(row.get("casino_name")),
            }
            for row in projects
        ],
        "work_orders": [
            {
                "date_wo": _day(row.get("date_wo")),
                "wo": _text(row.get("wo")),
                "property": _text(row.get("property")),
                "serial": _text(row.get("compid")),
                "vendor": _text(row.get("vendor_name")),
                "cabinet": _text(row.get("cabinet_name")),
                "theme": _text(row.get("theme_name")),
                "description": _text(row.get("brief_desc")),
            }
            for row in work_orders
        ],
    }
