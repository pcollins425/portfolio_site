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
            ims.reference_key,
            CAST(ims.project_number AS nvarchar(50)) AS project_number,
            ims.start_date,
            ims.end_date,
            ims.status,
            ims.project_type,
            ims.description,
            ims.lead_tech,
            ims.assistant_techs,
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
            wo.property,
            wo.assignto,
            wo.brief_desc,
            wo.sch_date,
            wo.stattype,
            wo.wo_type
        FROM projects.work_orders AS wo
        WHERE {_OPEN_WO}
        {wo_sql}
        ORDER BY wo.sch_date DESC, wo.wo DESC
        """,
        wo_params or None,
    )
    return {
        "scope": "mine" if mine else "all",
        "projects": [
            {
                "reference_key": _text(row.get("reference_key")),
                "project_number": _text(row.get("project_number")),
                "start_date": _day(row.get("start_date")),
                "end_date": _day(row.get("end_date")),
                "status": _text(row.get("status")),
                "project_type": _text(row.get("project_type")),
                "description": _text(row.get("description")),
                "lead_tech": _text(row.get("lead_tech")),
                "assistant_techs": _text(row.get("assistant_techs")),
                "casino_name": _text(row.get("casino_name")),
            }
            for row in projects
        ],
        "work_orders": [
            {
                "wo": _text(row.get("wo")),
                "property": _text(row.get("property")),
                "assignto": _text(row.get("assignto")),
                "brief_desc": _text(row.get("brief_desc")),
                "sch_date": _day(row.get("sch_date")),
                "stattype": _text(row.get("stattype")),
                "wo_type": _text(row.get("wo_type")),
            }
            for row in work_orders
        ],
    }
