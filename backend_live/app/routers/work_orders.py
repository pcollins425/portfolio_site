"""Work Orders module — read-only browse and detail (Contracts/Projects style).

Technicians see WOs for casinos on their route (``clients.casinos.techs``).
Other roles with the grant see every row. Write path comes later.
"""

from __future__ import annotations

import html
import os
import re
import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app import appsheet_client
from app import mssql
from app import permission_catalog as cat
from app.auth_deps import require_area_read, require_demo_user
from app.casino_scope import (
    assigned_employee_id,
    columns_contain_any,
    sql_params,
    sql_predicate,
)

router = APIRouter(
    prefix="/api/work-orders",
    tags=["work-orders"],
    dependencies=[Depends(require_area_read(cat.WORK_ORDERS_AREA))],
)

StatusFilter = Literal["open", "closed", "all"]

_WO_DIGITS = re.compile(r"^\d{5}$")


class PartRequestIn(BaseModel):
    dgs_part: str = Field(min_length=1, max_length=80)
    quantity: float = Field(default=1, gt=0, le=9999)
    job_type: str = Field(default="Repair", max_length=40)
    importance: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=2000)
    ship_to_category: str | None = Field(default="Primary Location", max_length=80)


_OPEN = """
    wo.workstatus = N'O'
    AND ISNULL(wo.stattype, N'') NOT IN (N'Completed', N'Cancelled')
"""

_CLOSED = """
    (
      wo.workstatus <> N'O'
      OR ISNULL(wo.stattype, N'') IN (N'Completed', N'Cancelled')
    )
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


def _num(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _has_priority_column() -> bool:
    rows = _query(
        """
        SELECT 1 AS ok
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = N'projects'
          AND TABLE_NAME = N'work_orders'
          AND COLUMN_NAME = N'priority'
        """
    )
    return bool(rows)


def _route_scope(user: dict[str, Any] | None) -> tuple[str, tuple[Any, ...]]:
    employee_id = assigned_employee_id(user)
    if not employee_id:
        return "", ()
    return f" AND {sql_predicate('cas')}", sql_params(employee_id)


def _detail_scope(user: dict[str, Any] | None) -> tuple[str, tuple[Any, ...]]:
    """Techs: casino on their route, or WO assigned to them (Field list)."""
    employee_id = assigned_employee_id(user)
    if not employee_id:
        return "", ()
    from app.routers import projects as project_routes

    named_sql, named_params = columns_contain_any(
        ["wo.assignto"],
        project_routes._project_needles(user),
    )
    return (
        f" AND ({sql_predicate('cas')} OR {named_sql})",
        sql_params(employee_id) + named_params,
    )


def _status_sql(status: str) -> str:
    raw = (status or "open").strip().lower()
    if raw == "all":
        return ""
    if raw == "closed":
        return f" AND {_CLOSED}"
    return f" AND {_OPEN}"


def _base_joins() -> str:
    return """
        FROM projects.work_orders AS wo
        LEFT JOIN clients.casinos AS cas ON cas.reference_key = wo.casino_id
        LEFT JOIN inventory.assets AS ast ON ast.reference_key = wo.asset_id
        LEFT JOIN vendors.vendors AS ven ON ven.reference_key = ast.vendor_id
        LEFT JOIN vendors.cabinets AS cab ON cab.reference_key = ast.cabinet_id
        LEFT JOIN vendors.themes AS th ON th.reference_key = wo.theme_id
    """


def _list_row(row: dict, *, include_priority: bool) -> dict[str, Any]:
    out = {
        "wo": _text(row.get("wo")),
        "reference_key": _text(row.get("reference_key")),
        "date_wo": _day(row.get("date_wo")),
        "property": _text(row.get("casino_name") or row.get("property")) or "Unassigned",
        "casino_id": _text(row.get("casino_id")),
        "serial": _text(row.get("serial")),
        "asset_id": _text(row.get("asset_id")),
        "vendor_id": _text(row.get("vendor_id")),
        "cabinet_id": _text(row.get("cabinet_id")),
        "theme_id": _text(row.get("theme_id")),
        "vendor": _text(row.get("vendor_name")),
        "cabinet": _text(row.get("cabinet_name")),
        "theme": _text(row.get("theme_name") or row.get("comp_desc")),
        "workstatus": _text(row.get("workstatus")),
        "stattype": _text(row.get("stattype")),
        "wo_type": _text(row.get("wo_type")),
        "assignto": _text(row.get("assignto")),
        "requestor": _text(row.get("requestor")),
        "req_tele": _text(row.get("req_tele")),
        "brief_desc": _text(row.get("brief_desc")),
        "hours": round(_num(row.get("hours")) or 0, 2) if row.get("hours") is not None else None,
        "moneypenny": bool(row.get("moneypenny")),
    }
    if include_priority:
        out["priority"] = _text(row.get("priority"))
    return out


@router.get("")
def work_orders_list(
    q: Annotated[str | None, Query()] = None,
    status: Annotated[str, Query()] = "open",
    wo_type: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    include_priority = _has_priority_column()
    priority_select = "wo.priority," if include_priority else ""
    scope_sql, scope_params = _route_scope(user)
    status_sql = _status_sql(status)

    where = [f"1 = 1{status_sql}{scope_sql}"]
    params: list[Any] = list(scope_params)

    type_raw = (wo_type or "").strip()
    if type_raw:
        where.append("wo.wo_type = %s")
        params.append(type_raw)

    needle = (q or "").strip()
    if needle:
        like = f"%{needle}%"
        where.append(
            """
            (
              wo.wo LIKE %s
              OR wo.reference_key LIKE %s
              OR wo.property LIKE %s
              OR cas.casino_name LIKE %s
              OR wo.compid LIKE %s
              OR ast.serial_number LIKE %s
              OR wo.brief_desc LIKE %s
              OR wo.requestor LIKE %s
              OR wo.assignto LIKE %s
              OR wo.stattype LIKE %s
            )
            """
        )
        params.extend([like] * 10)

    where_sql = " AND ".join(where)
    count_rows = _query(
        f"""
        SELECT COUNT(*) AS n
        {_base_joins()}
        WHERE {where_sql}
        """,
        tuple(params),
    )
    total = int((count_rows[0] or {}).get("n") or 0) if count_rows else 0

    rows = _query(
        f"""
        SELECT
            wo.wo,
            wo.reference_key,
            wo.date_wo,
            wo.property,
            wo.casino_id,
            cas.casino_name,
            wo.compid,
            wo.asset_id,
            wo.theme_id,
            ast.vendor_id,
            ast.cabinet_id,
            COALESCE(ast.serial_number, wo.compid) AS serial,
            ven.vendor_name,
            cab.cabinet_name,
            COALESCE(th.theme_name, wo.comp_desc) AS theme_name,
            wo.comp_desc,
            wo.workstatus,
            wo.stattype,
            wo.wo_type,
            wo.assignto,
            wo.requestor,
            wo.req_tele,
            wo.brief_desc,
            wo.hours,
            {priority_select}
            CASE
              WHEN CAST(wo.work_desc AS nvarchar(max)) LIKE N'%Moneypenny%' THEN 1
              ELSE 0
            END AS moneypenny
        {_base_joins()}
        WHERE {where_sql}
        ORDER BY wo.date_wo DESC, wo.wo DESC
        OFFSET %s ROWS FETCH NEXT %s ROWS ONLY
        """,
        tuple(params + [offset, limit]),
    )

    emp = assigned_employee_id(user)
    return {
        "scope": "route" if emp else "all",
        "status": (status or "open").strip().lower(),
        "q": needle or None,
        "wo_type": type_raw or None,
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_priority": include_priority,
        "orders": [_list_row(row, include_priority=include_priority) for row in rows],
    }


@router.get("/meta")
def work_orders_meta(
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """Filter options for the browse toolbar."""
    del user
    types = _query(
        """
        SELECT DISTINCT wo_type AS value
        FROM projects.work_orders
        WHERE NULLIF(LTRIM(RTRIM(wo_type)), N'') IS NOT NULL
        ORDER BY wo_type
        """
    )
    return {
        "wo_types": [_text(row.get("value")) for row in types if _text(row.get("value"))],
        "has_priority": _has_priority_column(),
        "statuses": [
            {"value": "open", "label": "Open"},
            {"value": "closed", "label": "Closed"},
            {"value": "all", "label": "All"},
        ],
    }


def _can_write_part_requests(user: dict[str, Any] | None) -> bool:
    if user is None:
        return False
    return cat.has_area_write(user.get("permissions") or {}, cat.PART_REQUESTS_AREA)


def _require_part_request_write(user: dict[str, Any] | None) -> dict[str, Any]:
    if user is None or not _can_write_part_requests(user):
        raise HTTPException(status_code=403, detail="Part request write not available")
    return user


def _load_wo_for_part_request(
    wo: str,
    user: dict[str, Any] | None,
) -> dict[str, Any]:
    key = (wo or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="wo is required")
    scope_sql, scope_params = _detail_scope(user)
    rows = _query(
        f"""
        SELECT
            wo.wo,
            wo.reference_key,
            wo.property,
            wo.compid,
            wo.asset_id,
            wo.project_no,
            wo.assignto,
            COALESCE(ast.serial_number, wo.compid) AS serial
        {_base_joins()}
        WHERE (wo.wo = %s OR wo.reference_key = %s)
        {scope_sql}
        """,
        (key, key, *scope_params),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Work order not found")
    row = rows[0]
    wo_num = _text(row.get("wo"))
    if not wo_num or not _WO_DIGITS.match(wo_num):
        raise HTTPException(
            status_code=400,
            detail="Work order needs a 5-digit eMaint WO # before a part request",
        )
    return row


@router.get("/part-catalog/search")
def part_catalog_search(
    q: str = Query("", max_length=80),
    limit: int = Query(20, ge=1, le=50),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """Search AppSheet Parts (Tech app) for DGS Part # picker."""
    _require_part_request_write(user)
    needle = (q or "").strip().replace('"', "")
    if len(needle) < 2:
        return {"q": needle or None, "parts": []}
    # Escape for AppSheet expression; keep simple CONTAINS on key + name.
    safe = needle.replace("\\", "")
    selector = (
        f'TOP(FILTER({appsheet_client.PARTS_TABLE}, '
        f'OR(CONTAINS([Part ID (Key)], "{safe}"), '
        f'CONTAINS(LOWER([Part Name]), LOWER("{safe}"))), '
        f"{int(limit)})"
    )
    try:
        rows = appsheet_client.find_rows(
            appsheet_client.PARTS_TABLE,
            selector=selector,
        )
    except appsheet_client.AppSheetError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Parts search failed: {exc}",
        ) from exc
    parts = []
    for row in rows:
        item = _text(row.get("Part ID (Key)"))
        if not item:
            continue
        parts.append(
            {
                "item": item,
                "name": _text(row.get("Part Name")),
                "mfr": _text(row.get("Manufacturer")),
                "mfr_part": _text(row.get("MFR Part No.")),
                "category": _text(row.get("Category")),
                "stock": _text(row.get("Stock")),
            }
        )
    return {"q": needle, "parts": parts}


@router.get("/{wo}/part-requests")
def list_part_requests(
    wo: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    row = _load_wo_for_part_request(wo, user)
    wo_num = _text(row.get("wo"))
    assert wo_num
    selector = (
        f'FILTER({appsheet_client.TECH_ORDER_TABLE}, '
        f'[Work Order #] = "{wo_num}")'
    )
    try:
        rows = appsheet_client.find_rows(
            appsheet_client.TECH_ORDER_TABLE,
            selector=selector,
        )
    except appsheet_client.AppSheetError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Part request list failed: {exc}",
        ) from exc
    out = []
    for r in rows:
        out.append(
            {
                "tech_order": _text(r.get("Tech Order #")),
                "dgs_part": _text(r.get("DGS Part #")),
                "quantity": _text(r.get("Quantity")),
                "status": _text(r.get("Status")),
                "status_2": _text(r.get("Status 2")),
                "date": _text(r.get("Date")),
                "tech_name": _text(r.get("Tech Name")),
                "part_description": _text(r.get("Part Description"))
                or _text(r.get("Description")),
                "importance": _text(r.get("Importance")),
            }
        )
    return {
        "wo": wo_num,
        "can_write": _can_write_part_requests(user),
        "requests": out,
    }


@router.post("/{wo}/part-requests")
def create_part_request(
    wo: str,
    body: PartRequestIn,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    user = _require_part_request_write(user)
    row = _load_wo_for_part_request(wo, user)
    wo_num = _text(row.get("wo"))
    assert wo_num

    part_id = (body.dgs_part or "").strip()
    try:
        part_rows = appsheet_client.find_rows(
            appsheet_client.PARTS_TABLE,
            selector=(
                f'FILTER({appsheet_client.PARTS_TABLE}, '
                f'[Part ID (Key)] = "{part_id.replace(chr(34), "")}")'
            ),
        )
    except appsheet_client.AppSheetError as exc:
        raise HTTPException(status_code=502, detail=f"Part lookup failed: {exc}") from exc
    if not part_rows:
        raise HTTPException(status_code=400, detail=f"Unknown DGS part # {part_id}")

    part_name = _text(part_rows[0].get("Part Name"))
    today = date.today().isoformat()
    tech_name = _text(user.get("name")) or "DGS App"
    tech_email = _text(user.get("email"))
    initials = "".join(
        p[0] for p in re.split(r"\s+", tech_name) if p
    ).upper()[:3] or "DG"
    tech_order = f"TO{initials}{uuid.uuid4().hex[:5].upper()}{wo_num}"

    asset = _text(row.get("serial")) or _text(row.get("compid"))
    payload = {
        "Tech Order #": tech_order,
        "Work Order #": wo_num,
        "DGS Part #": part_id,
        "Quantity": str(int(body.quantity) if float(body.quantity).is_integer() else body.quantity),
        "Status": "Open",
        "Status 2": "Open",
        "Date": today,
        "Tech Name": tech_name,
        "Job Type": (body.job_type or "Repair").strip() or "Repair",
        "Part Description": part_name or "",
        "Entered By Email": tech_email or "",
        "Tech Email": tech_email or "",
        "Tech Initials": initials,
        "Ship To Catagory": (body.ship_to_category or "Primary Location").strip(),
    }
    if asset:
        payload["Asset ID"] = asset
    if _text(row.get("project_no")):
        payload["Project #"] = _text(row.get("project_no"))
    if body.importance and body.importance.strip():
        payload["Importance"] = body.importance.strip()
    if body.notes and body.notes.strip():
        payload["Notes"] = body.notes.strip()

    try:
        created = appsheet_client.add_rows(
            appsheet_client.TECH_ORDER_TABLE,
            [payload],
        )
    except appsheet_client.AppSheetError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Part request create failed: {exc} {exc.body[:300]}",
        ) from exc

    created_row = created[0] if created else payload
    return {
        "ok": True,
        "wo": wo_num,
        "tech_order": _text(created_row.get("Tech Order #")) or tech_order,
        "dgs_part": part_id,
        "quantity": payload["Quantity"],
        "status": "Open",
    }


@router.get("/{wo}")
def work_order_detail(
    wo: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    key = (wo or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="wo is required")

    include_priority = _has_priority_column()
    priority_select = "wo.priority," if include_priority else ""
    scope_sql, scope_params = _detail_scope(user)

    rows = _query(
        f"""
        SELECT
            wo.wo,
            wo.reference_key,
            wo.uuid,
            wo.date_wo,
            wo.sch_date,
            wo.date_cmpl,
            wo.property,
            wo.casino_id,
            cas.casino_name,
            wo.compid,
            wo.asset_id,
            wo.theme_id,
            wo.project_no,
            ast.vendor_id,
            ast.cabinet_id,
            COALESCE(ast.serial_number, wo.compid) AS serial,
            ven.vendor_name,
            cab.cabinet_name,
            COALESCE(th.theme_name, wo.comp_desc) AS theme_name,
            wo.comp_desc,
            wo.workstatus,
            wo.stattype,
            wo.wo_type,
            wo.assignto,
            wo.assignid,
            wo.assigntype,
            wo.requestor,
            wo.req_tele,
            wo.brief_desc,
            wo.work_desc,
            wo.comments,
            wo.commlog,
            wo.probtype,
            wo.bank,
            wo.location,
            wo.state,
            wo.hours,
            wo.act_hours,
            wo.workmhours,
            wo.drivetime,
            wo.downstart,
            wo.downend,
            wo.game_oos,
            wo.asst_dwn,
            wo.in_serv,
            wo.onholdprt,
            wo.pts_rdy,
            wo.clsdby,
            wo.adduser,
            wo.adddate,
            wo.edituser,
            wo.editdate,
            {priority_select}
            CASE
              WHEN CAST(wo.work_desc AS nvarchar(max)) LIKE N'%Moneypenny%' THEN 1
              ELSE 0
            END AS moneypenny
        {_base_joins()}
        WHERE (wo.wo = %s OR wo.reference_key = %s)
        {scope_sql}
        """,
        (key, key, *scope_params),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Work order not found")
    row = rows[0]
    wo_key = _text(row.get("wo"))

    materials: list[dict[str, Any]] = []
    materials_total: float | None = None
    if wo_key:
        mat_rows = _query(
            """
            SELECT
                mat.item,
                inv.descrip AS item_descrip,
                inv.mfr AS item_mfr,
                inv.mfrpartno AS item_mfrpartno,
                mat.qty_requested,
                mat.qty_allocated,
                mat.qty_issued,
                mat.status,
                mat.unit_cost,
                mat.ext_cost,
                mat.source
            FROM projects.work_order_material AS mat
            LEFT JOIN inventory.inventory AS inv
              ON LTRIM(RTRIM(CAST(inv.item AS nvarchar(100))))
               = LTRIM(RTRIM(CAST(mat.item AS nvarchar(100))))
            WHERE mat.wo = %s
            ORDER BY mat.index_key, mat.item
            """,
            (wo_key,),
        )
        materials = [
            {
                "item": _text(m.get("item")),
                "descrip": _text(m.get("item_descrip")),
                "mfr": _text(m.get("item_mfr")),
                "mfrpartno": _text(m.get("item_mfrpartno")),
                "qty_requested": _num(m.get("qty_requested")),
                "qty_allocated": _num(m.get("qty_allocated")),
                "qty_issued": _num(m.get("qty_issued")),
                "status": _text(m.get("status")),
                "unit_cost": round(_num(m.get("unit_cost")) or 0, 2)
                if m.get("unit_cost") is not None
                else None,
                "ext_cost": round(_num(m.get("ext_cost")) or 0, 2)
                if m.get("ext_cost") is not None
                else None,
                "source": _text(m.get("source")),
            }
            for m in mat_rows
        ]
        if materials:
            materials_total = round(
                sum((_num(m.get("ext_cost")) or 0.0) for m in materials),
                2,
            )

    detail = {
        "wo": wo_key,
        "reference_key": _text(row.get("reference_key")),
        "date_wo": _day(row.get("date_wo")),
        "sch_date": _day(row.get("sch_date")),
        "date_cmpl": _day(row.get("date_cmpl")),
        "property": _text(row.get("casino_name") or row.get("property")) or "Unassigned",
        "casino_id": _text(row.get("casino_id")),
        "serial": _text(row.get("serial")),
        "compid": _text(row.get("compid")),
        "asset_id": _text(row.get("asset_id")),
        "theme_id": _text(row.get("theme_id")),
        "project_no": _text(row.get("project_no")),
        "vendor_id": _text(row.get("vendor_id")),
        "cabinet_id": _text(row.get("cabinet_id")),
        "vendor": _text(row.get("vendor_name")),
        "cabinet": _text(row.get("cabinet_name")),
        "theme": _text(row.get("theme_name") or row.get("comp_desc")),
        "workstatus": _text(row.get("workstatus")),
        "stattype": _text(row.get("stattype")),
        "wo_type": _text(row.get("wo_type")),
        "assignto": _text(row.get("assignto")),
        "assignid": _text(row.get("assignid")),
        "assigntype": _text(row.get("assigntype")),
        "requestor": _text(row.get("requestor")),
        "req_tele": _text(row.get("req_tele")),
        "brief_desc": _text(row.get("brief_desc")),
        "work_desc": _text(row.get("work_desc")),
        "comments": _text(row.get("comments")),
        "commlog": _text(row.get("commlog")),
        "probtype": _text(row.get("probtype")),
        "bank": _text(row.get("bank")),
        "location": _text(row.get("location")),
        "state": _text(row.get("state")),
        "hours": round(_num(row.get("hours")) or 0, 2) if row.get("hours") is not None else None,
        "act_hours": round(_num(row.get("act_hours")) or 0, 2)
        if row.get("act_hours") is not None
        else None,
        "workmhours": round(_num(row.get("workmhours")) or 0, 2)
        if row.get("workmhours") is not None
        else None,
        "drivetime": round(_num(row.get("drivetime")) or 0, 2)
        if row.get("drivetime") is not None
        else None,
        "downstart": _day(row.get("downstart")),
        "downend": _day(row.get("downend")),
        "game_oos": _text(row.get("game_oos")),
        "asst_dwn": _text(row.get("asst_dwn")),
        "in_serv": _text(row.get("in_serv")),
        "onholdprt": _text(row.get("onholdprt")),
        "pts_rdy": _day(row.get("pts_rdy")),
        "clsdby": _text(row.get("clsdby")),
        "adduser": _text(row.get("adduser")),
        "adddate": _day(row.get("adddate")),
        "edituser": _text(row.get("edituser")),
        "editdate": _day(row.get("editdate")),
        "moneypenny": bool(row.get("moneypenny")),
        "materials": materials,
        "materials_total": materials_total,
        "part_requests": {
            "can_write": _can_write_part_requests(user),
            "wo_ready": bool(wo_key and _WO_DIGITS.match(wo_key)),
        },
    }
    if include_priority:
        detail["priority"] = _text(row.get("priority"))
    return detail
