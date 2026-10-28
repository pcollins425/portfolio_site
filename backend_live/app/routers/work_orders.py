"""Work Orders module — read-only browse and detail (Contracts/Projects style).

Technicians see WOs for casinos on their route (``clients.casinos.techs``).
Other roles with the grant see every row. Write path comes later.
"""

from __future__ import annotations

import base64
import html
import json
import os
import re
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app import appsheet_client
from app import emaint_client
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


_PART_REQUEST_SHIP_TO = frozenset({"Primary Location", "Casino", "Other"})
_PART_REQUEST_JOB_TYPES = frozenset({"Repair", "Stock", "Install"})


class PartRequestIn(BaseModel):
    dgs_part: str = Field(min_length=1, max_length=80)
    quantity: float = Field(default=1, gt=0, le=9999)
    job_type: str = Field(default="Repair", max_length=40)
    tech_name: str | None = Field(default=None, max_length=120)
    part_description: str | None = Field(default=None, max_length=500)
    importance: str | None = Field(default=None, max_length=80)
    notes: str | None = Field(default=None, max_length=2000)
    ship_to_category: str = Field(default="Primary Location", max_length=80)
    ship_to_address: str | None = Field(default=None, max_length=500)
    # data URLs or raw base64 — stored locally and passed to AppSheet as public image URLs
    pics: list[str] | None = Field(default=None, max_length=3)


class WorkOrderCreateIn(BaseModel):
    casino_id: str = Field(min_length=1, max_length=40)
    property: str | None = Field(default=None, max_length=30)
    compid: str | None = Field(default=None, max_length=21)
    asset_id: str | None = Field(default=None, max_length=25)
    brief_desc: str = Field(min_length=1, max_length=100)
    work_desc: str | None = Field(default=None, max_length=8000)
    wo_type: str | None = Field(default=None, max_length=12)
    probtype: str | None = Field(default=None, max_length=80)
    asst_dwn: str = Field(default="No", max_length=20)
    game_oos: str | None = Field(default=None, max_length=3)
    assignto: str | None = Field(default=None, max_length=100)
    assignid: str | None = Field(default=None, max_length=10)
    assigntype: str | None = Field(default=None, max_length=15)
    requestor: str | None = Field(default=None, max_length=50)
    req_tele: str | None = Field(default=None, max_length=20)
    drivetime: float | None = Field(default=None, ge=0, le=999)
    workmhours: float | None = Field(default=None, ge=0, le=999)


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
    types = _query(
        """
        SELECT DISTINCT wo_type AS value
        FROM projects.work_orders
        WHERE NULLIF(LTRIM(RTRIM(wo_type)), N'') IS NOT NULL
        ORDER BY wo_type
        """
    )
    probs = _query(
        """
        SELECT DISTINCT TOP 40 probtype AS value
        FROM projects.work_orders
        WHERE NULLIF(LTRIM(RTRIM(probtype)), N'') IS NOT NULL
        ORDER BY probtype
        """
    )
    can_create = _can_write_part_requests(user)
    return {
        "wo_types": [_text(row.get("value")) for row in types if _text(row.get("value"))],
        "prob_types": [_text(row.get("value")) for row in probs if _text(row.get("value"))],
        "has_priority": _has_priority_column(),
        "can_create": can_create,
        "create_preview_only": not can_create,
        "scope": "route" if assigned_employee_id(user) else "all",
        "statuses": [
            {"value": "open", "label": "Open"},
            {"value": "closed", "label": "Closed"},
            {"value": "all", "label": "All"},
        ],
    }


def _asset_resolve_row(row: dict[str, Any]) -> dict[str, Any]:
    serial = _text(row.get("serial_number")) or _text(row.get("asset_no"))
    cabinet = " · ".join(
        p
        for p in (
            _text(row.get("vendor_name")),
            _text(row.get("cabinet_name")),
        )
        if p
    )
    return {
        "asset_id": _text(row.get("asset_id")),
        "asset_no": _text(row.get("asset_no")),
        "compid": serial,
        "serial": serial,
        "casino_id": _text(row.get("casino_id")),
        "casino_name": _text(row.get("casino_name")),
        "casino_short": _text(row.get("casino_short")),
        "property": _text(row.get("emaint_property")) or _text(row.get("casino_name")),
        "theme": _text(row.get("theme_name")),
        "theme_id": _text(row.get("theme_id")),
        "cabinet": cabinet or None,
        "bank": _text(row.get("bank")),
        "location": _text(row.get("location")),
        "zone": _text(row.get("zone")),
        "label": " · ".join(
            p
            for p in (
                serial,
                cabinet or None,
                _text(row.get("theme_name")),
                _text(row.get("casino_short")) or _text(row.get("casino_name")),
            )
            if p
        ),
    }


@router.get("/create/places")
def create_places(
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """Route-scoped state / tribe / casino lists for Add WO (any order)."""
    employee_id = assigned_employee_id(user)
    if employee_id:
        scope_sql = f" AND {sql_predicate('c')}"
        scope_params = sql_params(employee_id)
    else:
        scope_sql = ""
        scope_params = ()
    rows = _query(
        f"""
        SELECT DISTINCT
            st.reference_key AS state_id,
            st.state AS state_name,
            t.reference_key AS tribe_id,
            t.tribe_name,
            c.reference_key AS casino_id,
            c.casino_name,
            c.casino_short,
            c.emaint_property
        FROM clients.casinos AS c
        LEFT JOIN clients.states AS st ON st.reference_key = c.state_id
        LEFT JOIN clients.tribes AS t ON t.reference_key = c.tribe_id
        WHERE c.reference_key IS NOT NULL
          {scope_sql}
        ORDER BY st.state, t.tribe_name, c.casino_name
        """,
        scope_params or None,
    )
    states: dict[str, dict[str, Any]] = {}
    tribes: dict[str, dict[str, Any]] = {}
    casinos: list[dict[str, Any]] = []
    for row in rows:
        sid = _text(row.get("state_id"))
        tid = _text(row.get("tribe_id"))
        cid = _text(row.get("casino_id"))
        if sid and sid not in states:
            states[sid] = {
                "state_id": sid,
                "state_name": _text(row.get("state_name")) or sid,
            }
        if tid and tid not in tribes:
            tribes[tid] = {
                "tribe_id": tid,
                "tribe_name": _text(row.get("tribe_name")) or tid,
                "state_id": sid,
            }
        if cid:
            casinos.append(
                {
                    "casino_id": cid,
                    "casino_name": _text(row.get("casino_name")) or cid,
                    "casino_short": _text(row.get("casino_short")),
                    "property": _text(row.get("emaint_property"))
                    or _text(row.get("casino_name")),
                    "state_id": sid,
                    "tribe_id": tid,
                }
            )
    return {
        "states": sorted(states.values(), key=lambda r: (r.get("state_name") or "")),
        "tribes": sorted(tribes.values(), key=lambda r: (r.get("tribe_name") or "")),
        "casinos": casinos,
    }


@router.get("/create/resolve-asset")
def create_resolve_asset(
    q: str = Query("", max_length=80),
    limit: int = Query(15, ge=1, le=40),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """Find active floor machines for Add WO (route-scoped for techs)."""
    needle = (q or "").strip()
    if len(needle) < 2:
        return {"q": needle or None, "matches": []}
    scope_sql, scope_params = _route_scope(user)
    like = f"%{needle.replace('[', '[[]').replace('%', '[%]').replace('_', '[_]')}%"
    rows = _query(
        f"""
        SELECT TOP ({int(limit)})
            sm.asset_id,
            sm.asset_no,
            sm.casino_id,
            sm.theme_id,
            sm.bank,
            sm.location,
            sm.zone,
            ast.serial_number,
            cas.casino_name,
            cas.casino_short,
            cas.emaint_property,
            ven.vendor_name,
            cab.cabinet_name,
            th.theme_name
        FROM inventory.slot_master_migration AS sm
        INNER JOIN clients.casinos AS cas ON cas.reference_key = sm.casino_id
        LEFT JOIN inventory.assets AS ast ON ast.reference_key = sm.asset_id
        LEFT JOIN vendors.vendors AS ven ON ven.reference_key = ast.vendor_id
        LEFT JOIN vendors.cabinets AS cab ON cab.reference_key = ast.cabinet_id
        LEFT JOIN vendors.themes AS th ON th.reference_key = sm.theme_id
        WHERE sm.is_active = 1
          AND (
            sm.asset_no LIKE %s
            OR ast.serial_number LIKE %s
            OR cas.casino_name LIKE %s
            OR cas.casino_short LIKE %s
            OR th.theme_name LIKE %s
          )
          {scope_sql}
        ORDER BY
          CASE
            WHEN sm.asset_no = %s OR ast.serial_number = %s THEN 0
            WHEN sm.asset_no LIKE %s OR ast.serial_number LIKE %s THEN 1
            ELSE 2
          END,
          cas.casino_name,
          sm.asset_no
        """,
        (like, like, like, like, like, *scope_params, needle, needle, f"{needle}%", f"{needle}%"),
    )
    return {"q": needle, "matches": [_asset_resolve_row(r) for r in rows]}


@router.get("/create/casino-assets")
def create_casino_assets(
    casino_id: str = Query(..., min_length=1, max_length=40),
    limit: int = Query(80, ge=1, le=200),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """Active machines at one casino (route-scoped)."""
    cid = casino_id.strip()
    scope_sql, scope_params = _route_scope(user)
    rows = _query(
        f"""
        SELECT TOP ({int(limit)})
            sm.asset_id,
            sm.asset_no,
            sm.casino_id,
            sm.theme_id,
            sm.bank,
            sm.location,
            sm.zone,
            ast.serial_number,
            cas.casino_name,
            cas.casino_short,
            cas.emaint_property,
            ven.vendor_name,
            cab.cabinet_name,
            th.theme_name
        FROM inventory.slot_master_migration AS sm
        INNER JOIN clients.casinos AS cas ON cas.reference_key = sm.casino_id
        LEFT JOIN inventory.assets AS ast ON ast.reference_key = sm.asset_id
        LEFT JOIN vendors.vendors AS ven ON ven.reference_key = ast.vendor_id
        LEFT JOIN vendors.cabinets AS cab ON cab.reference_key = ast.cabinet_id
        LEFT JOIN vendors.themes AS th ON th.reference_key = sm.theme_id
        WHERE sm.is_active = 1
          AND sm.casino_id = %s
          {scope_sql}
        ORDER BY sm.asset_no, ast.serial_number
        """,
        (cid, *scope_params),
    )
    return {
        "casino_id": cid,
        "assets": [_asset_resolve_row(r) for r in rows],
    }


def _emaint_compinfo_assignment(compid: str) -> dict[str, str | None]:
    """Pull WORK assignment defaults from eMaint COMPINFO (not mirrored in SQL landing)."""
    serial = (compid or "").strip()
    if not serial:
        return {}
    try:
        rows = emaint_client.get_any_data(
            table="COMPINFO",
            columns="compid,assignto,assigntype,assignid,property,state",
            filters=[{"field": "compid", "operator": "eq", "value": serial}],
            page_size=1,
        )
    except Exception:
        return {}
    if not rows:
        return {}
    row = rows[0] or {}
    return {
        "compid": _text(row.get("compid")) or serial,
        "assignto": _text(row.get("assignto")),
        "assigntype": _text(row.get("assigntype")) or "Employee",
        "assignid": _text(row.get("assignid")),
        "property": _text(row.get("property")),
        "state": _text(row.get("state")),
    }


_PART_PIC_DIR = Path(
    (os.environ.get("PART_REQUEST_PIC_DIR") or "").strip()
    # Prefer the assistant_sessions volume so pics survive container rebuilds long
    # enough for AppSheet to fetch the public image URL.
    or "/app/data/assistant_sessions/part_request_pics"
)
_PART_PIC_RE = re.compile(
    r"^data:(image/(?:jpeg|jpg|png|webp|gif));base64,(.+)$",
    re.IGNORECASE | re.DOTALL,
)
_PART_PIC_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


def _public_api_base() -> str:
    return (
        (os.environ.get("PUBLIC_API_BASE") or "").strip().rstrip("/")
        or "https://api.collinsmediallc.com"
    )


def _store_part_request_pic(data_url: str) -> str:
    """Persist a browser data-URL image; return a public HTTPS URL for AppSheet Image fields."""
    raw = (data_url or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty picture payload")
    mime = "image/jpeg"
    b64 = raw
    match = _PART_PIC_RE.match(raw)
    if match:
        mime = match.group(1).lower()
        b64 = match.group(2)
    elif raw.startswith("data:"):
        raise HTTPException(status_code=400, detail="Unsupported picture format")
    try:
        content = base64.b64decode(b64, validate=False)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid picture encoding") from exc
    if not content:
        raise HTTPException(status_code=400, detail="Empty picture data")
    if len(content) > 8 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Picture too large (max 8 MB)")
    ext = _PART_PIC_EXT.get(mime, ".jpg")
    _PART_PIC_DIR.mkdir(parents=True, exist_ok=True)
    file_id = f"{uuid.uuid4().hex}{ext}"
    path = _PART_PIC_DIR / file_id
    path.write_bytes(content)
    return f"{_public_api_base()}/api/work-orders/part-request-files/{file_id}"


@router.get("/part-request-files/{file_id}")
def get_part_request_file(file_id: str):
    """Public image fetch for AppSheet Image columns (unguessable UUID filenames)."""
    name = (file_id or "").strip()
    if not re.fullmatch(r"[a-f0-9]{32}\.(jpg|jpeg|png|webp|gif)", name, re.I):
        raise HTTPException(status_code=404, detail="Not found")
    path = _PART_PIC_DIR / name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not found")
    media = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
    }.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media)


def _emaint_adduser_for_account(user: dict[str, Any] | None) -> str | None:
    """Map the signed-in DGS account to eMaint CONTACT ``cuserid`` for WORK.adduser.

    Separate from Assign To (asset COMPINFO tech). Falls back to ``EMAINT_USER`` when
    CONTACT cannot be resolved.
    """
    email = _text((user or {}).get("email"))
    name = _text((user or {}).get("name"))
    rows: list[dict[str, Any]] = []
    if email:
        local = email.split("@", 1)[0]
        try:
            rows = emaint_client.get_any_data(
                table="CONTACT",
                columns="cuserid,fullname,email",
                filters=[{"field": "email", "operator": "contains", "value": local}],
                page_size=10,
            )
        except Exception:
            rows = []
        email_l = email.lower()
        rows = [
            r
            for r in rows
            if (_text(r.get("email")) or "").lower() == email_l
            or (_text(r.get("email")) or "").lower().startswith(local.lower() + "@")
        ]
    # Prefer a real person CONTACT over API service accounts when email matches several.
    def _score(row: dict[str, Any]) -> tuple[int, int, str]:
        uid = (_text(row.get("cuserid")) or "").upper()
        full = (_text(row.get("fullname")) or "").casefold()
        name_l = (name or "").casefold()
        prefer_name = 0
        if name_l and full:
            if full == name_l or name_l in full or full in name_l:
                prefer_name = 2
            elif all(p and p in full for p in name_l.replace(".", " ").split()):
                prefer_name = 1
        api_penalty = 1 if "API" in uid else 0
        return (prefer_name, -api_penalty, uid)

    if rows:
        best = sorted(rows, key=_score, reverse=True)[0]
        uid = _text(best.get("cuserid"))
        if uid:
            return uid
    if name:
        try:
            by_name = emaint_client.get_any_data(
                table="CONTACT",
                columns="cuserid,fullname,email",
                filters=[{"field": "fullname", "operator": "eq", "value": name}],
                page_size=3,
            )
        except Exception:
            by_name = []
        if len(by_name) == 1:
            uid = _text(by_name[0].get("cuserid"))
            if uid:
                return uid
    fallback = (os.environ.get("EMAINT_USER") or "").strip()
    return fallback.upper() if fallback else None


@router.get("/create/compinfo-assign")
def create_compinfo_assign(
    compid: str = Query(..., min_length=1, max_length=40),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """Asset-routed assign defaults for Add WO (Assign Type / Assign To / Assign ID)."""
    _ = user
    data = _emaint_compinfo_assignment(compid)
    if not data:
        return {
            "compid": compid.strip(),
            "assignto": None,
            "assigntype": "Employee",
            "assignid": None,
            "property": None,
            "found": False,
        }
    return {**data, "assigntype": data.get("assigntype") or "Employee", "found": True}


_YES_NO = frozenset({"yes", "no"})


def _yes_no(value: str | None, *, field: str) -> str:
    raw = (value or "").strip()
    if raw.lower() not in _YES_NO:
        raise HTTPException(status_code=400, detail=f"{field} must be Yes or No")
    return "Yes" if raw.lower() == "yes" else "No"


def _optional_float(value: float | None) -> float | None:
    if value is None:
        return None
    return float(value)


def _load_casino_for_create(
    casino_id: str,
    user: dict[str, Any] | None,
) -> dict[str, Any]:
    cid = (casino_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="casino_id is required")
    scope_sql, scope_params = _route_scope(user)
    rows = _query(
        f"""
        SELECT TOP 1
            c.reference_key AS casino_id,
            c.casino_name,
            c.casino_short,
            c.emaint_property,
            st.state AS state_name,
            st.reference_key AS state_id
        FROM clients.casinos AS c
        LEFT JOIN clients.states AS st ON st.reference_key = c.state_id
        WHERE c.reference_key = %s
          {scope_sql}
        """,
        (cid, *scope_params),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Casino not found or not on your route")
    return rows[0]


def _load_asset_for_create(
    *,
    asset_id: str | None,
    compid: str | None,
    casino_id: str,
    user: dict[str, Any] | None,
) -> dict[str, Any] | None:
    aid = (asset_id or "").strip()
    serial = (compid or "").strip()
    if not aid and not serial:
        return None
    scope_sql, scope_params = _route_scope(user)
    if aid:
        rows = _query(
            f"""
            SELECT TOP 1
                sm.asset_id,
                sm.asset_no,
                sm.casino_id,
                sm.theme_id,
                sm.bank,
                sm.location,
                ast.serial_number,
                cas.emaint_property,
                cas.casino_name,
                cab.cabinet_name,
                ven.vendor_name,
                th.theme_name
            FROM inventory.slot_master_migration AS sm
            INNER JOIN clients.casinos AS cas ON cas.reference_key = sm.casino_id
            LEFT JOIN inventory.assets AS ast ON ast.reference_key = sm.asset_id
            LEFT JOIN vendors.vendors AS ven ON ven.reference_key = ast.vendor_id
            LEFT JOIN vendors.cabinets AS cab ON cab.reference_key = ast.cabinet_id
            LEFT JOIN vendors.themes AS th ON th.reference_key = sm.theme_id
            WHERE sm.is_active = 1
              AND sm.asset_id = %s
              AND sm.casino_id = %s
              {scope_sql}
            """,
            (aid, casino_id, *scope_params),
        )
    else:
        rows = _query(
            f"""
            SELECT TOP 1
                sm.asset_id,
                sm.asset_no,
                sm.casino_id,
                sm.theme_id,
                sm.bank,
                sm.location,
                ast.serial_number,
                cas.emaint_property,
                cas.casino_name,
                cab.cabinet_name,
                ven.vendor_name,
                th.theme_name
            FROM inventory.slot_master_migration AS sm
            INNER JOIN clients.casinos AS cas ON cas.reference_key = sm.casino_id
            LEFT JOIN inventory.assets AS ast ON ast.reference_key = sm.asset_id
            LEFT JOIN vendors.vendors AS ven ON ven.reference_key = ast.vendor_id
            LEFT JOIN vendors.cabinets AS cab ON cab.reference_key = ast.cabinet_id
            LEFT JOIN vendors.themes AS th ON th.reference_key = sm.theme_id
            WHERE sm.is_active = 1
              AND sm.casino_id = %s
              AND (
                sm.asset_no = %s
                OR ast.serial_number = %s
              )
              {scope_sql}
            ORDER BY
              CASE WHEN ast.serial_number = %s THEN 0 ELSE 1 END,
              sm.asset_no
            """,
            (casino_id, serial, serial, serial, *scope_params),
        )
    if not rows:
        raise HTTPException(
            status_code=400,
            detail="Asset not found on that casino (or not on your route)",
        )
    return rows[0]


def _insert_work_order_sql(row: dict[str, Any]) -> dict[str, Any]:
    """Insert into projects.work_orders with CONTEXT_INFO 0x57 (skip outbound queue)."""
    conn = mssql.get_connection(database=_catalog(), profile="field", load_env=False)
    try:
        cur = conn.cursor(as_dict=True)
        # Skip enqueue — eMaint already has the row from this request.
        cur.execute(
            """
            DECLARE @ctx varbinary(128) = CONVERT(VARBINARY(128), CAST(0x57 AS BINARY(1)));
            SET CONTEXT_INFO @ctx;
            """
        )
        cur.execute(
            """
            INSERT INTO projects.work_orders (
                wo, property, state, casino_id, asset_id, theme_id, compid, comp_desc,
                bank, location, brief_desc, work_desc, wo_type, probtype,
                asst_dwn, game_oos, assignto, assignid, assigntype, adduser,
                requestor, req_tele, drivetime, workmhours, hours,
                workstatus, stattype, date_wo, adddate
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                N'O', N'Open', %s, %s
            )
            """,
            (
                row["wo"],
                row.get("property"),
                row.get("state"),
                row.get("casino_id"),
                row.get("asset_id"),
                row.get("theme_id"),
                row.get("compid"),
                row.get("comp_desc"),
                row.get("bank"),
                row.get("location"),
                row.get("brief_desc"),
                row.get("work_desc"),
                row.get("wo_type"),
                row.get("probtype"),
                row.get("asst_dwn"),
                row.get("game_oos"),
                row.get("assignto"),
                row.get("assignid"),
                row.get("assigntype") or "Employee",
                row.get("adduser"),
                row.get("requestor"),
                row.get("req_tele"),
                row.get("drivetime"),
                row.get("workmhours"),
                row.get("hours"),
                row.get("date_wo"),
                row.get("adddate"),
            ),
        )
        cur.execute(
            """
            SELECT TOP 1
                uuid, index_key, reference_key, wo, property, casino_id,
                asset_id, compid, brief_desc, workstatus, date_wo
            FROM projects.work_orders
            WHERE wo = %s
            ORDER BY index_key DESC
            """,
            (row["wo"],),
        )
        inserted = cur.fetchone()
        # Clear skip marker before returning the pooled connection.
        cur.execute(
            """
            DECLARE @z varbinary(128) = CONVERT(VARBINARY(128), CAST(0x00 AS BINARY(1)));
            SET CONTEXT_INFO @z;
            """
        )
        conn.commit()
        if not inserted:
            raise RuntimeError("SQL insert succeeded but row was not readable")
        return inserted
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        conn.close()


@router.post("/create")
def create_work_order(
    body: WorkOrderCreateIn,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """Allocate eMaint WO, create WORK, then insert projects.work_orders (dual-write)."""
    actor = _require_part_request_write(user)
    casino = _load_casino_for_create(body.casino_id, actor)
    casino_id = _text(casino.get("casino_id")) or body.casino_id.strip()
    property_name = (
        _text(body.property)
        or _text(casino.get("emaint_property"))
        or _text(casino.get("casino_name"))
    )
    if not property_name:
        raise HTTPException(status_code=400, detail="property is required")

    asset = _load_asset_for_create(
        asset_id=body.asset_id,
        compid=body.compid,
        casino_id=casino_id,
        user=actor,
    )
    asst_dwn = _yes_no(body.asst_dwn, field="asst_dwn")
    game_oos = _yes_no(body.game_oos or asst_dwn, field="game_oos")
    today = date.today().isoformat()
    date_stamp = f"{today}T00:00:00"
    serial = None
    asset_id = None
    theme_id = None
    bank = None
    location = None
    theme_name = None
    if asset:
        serial = (
            _text(asset.get("serial_number"))
            or _text(asset.get("asset_no"))
            or _text(body.compid)
        )
        asset_id = _text(asset.get("asset_id"))
        theme_id = _text(asset.get("theme_id"))
        bank = _text(asset.get("bank"))
        location = _text(asset.get("location"))
        theme_name = _text(asset.get("theme_name"))
    else:
        serial = _text(body.compid)

    brief = (body.brief_desc or "").strip()
    work_desc = (body.work_desc or "").strip() or None
    drivetime = _optional_float(body.drivetime)
    workmhours = _optional_float(body.workmhours)
    hours = workmhours

    # Assign Type/To come from the asset's COMPINFO (eMaint). Type is always Employee.
    ci_assign = _emaint_compinfo_assignment(serial) if serial else {}
    if ci_assign.get("property"):
        property_name = ci_assign["property"] or property_name
    # eMaint WORK.state is the full name (Oklahoma, California, …).
    state_name = (
        ci_assign.get("state")
        or _text(casino.get("state_name"))
    )
    assigntype = "Employee"
    assignto = _text(body.assignto) or ci_assign.get("assignto")
    assignid = _text(body.assignid) or ci_assign.get("assignid")
    # If the UI sent the COMPINFO name, keep COMPINFO assignid even if body omitted it.
    if (
        assignto
        and ci_assign.get("assignto")
        and assignto == ci_assign.get("assignto")
        and not assignid
    ):
        assignid = ci_assign.get("assignid")

    # Add User = signed-in account holder (CONTACT cuserid). Not the asset tech.
    adduser = _emaint_adduser_for_account(actor)

    emaint_payload: dict[str, Any] = {
        "brief_desc": brief,
        "work_desc": work_desc,
        "adddate": date_stamp,
        "date_wo": date_stamp,
        "property": property_name,
        "workstatus": "Open",
        "stattype": "Open",
        "assigntype": assigntype,
        "asst_dwn": asst_dwn,
        "game_oos": game_oos,
    }
    if serial:
        emaint_payload["compid"] = serial
    if state_name:
        emaint_payload["state"] = state_name
    if adduser:
        emaint_payload["adduser"] = adduser
    if _text(body.wo_type):
        emaint_payload["wo_type"] = _text(body.wo_type)
    if _text(body.probtype):
        emaint_payload["probtype"] = _text(body.probtype)
    if assignto:
        emaint_payload["assignto"] = assignto
    if assignid:
        emaint_payload["assignid"] = assignid
    if _text(body.requestor):
        emaint_payload["requestor"] = _text(body.requestor)
    if _text(body.req_tele):
        emaint_payload["req_tele"] = _text(body.req_tele)
    if drivetime is not None:
        emaint_payload["drivetime"] = drivetime
    if workmhours is not None:
        emaint_payload["workmhours"] = workmhours
    if bank:
        emaint_payload["bank"] = bank
    if location:
        emaint_payload["location"] = location
    if theme_name:
        emaint_payload["comp_desc"] = theme_name

    last_err = "eMaint create failed"
    assigned_wo: int | None = None
    for _attempt in range(5):
        try:
            candidate = emaint_client.allocate_next_work_wo()
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Could not allocate eMaint WO #: {exc}",
            ) from exc
        status, snippet = emaint_client.create_work_record(candidate, emaint_payload)
        if emaint_client.record_response_accepted(status, snippet):
            assigned_wo = candidate
            break
        last_err = snippet or f"HTTP {status}"
        if emaint_client.snippet_suggests_wo_conflict(snippet):
            continue
        raise HTTPException(status_code=502, detail=f"eMaint create failed: {last_err[:400]}")

    if assigned_wo is None:
        raise HTTPException(
            status_code=502,
            detail=f"eMaint create failed after retries: {last_err[:400]}",
        )

    sql_row = {
        "wo": str(assigned_wo),
        "property": property_name,
        "state": state_name,
        "casino_id": casino_id,
        "asset_id": asset_id,
        "theme_id": theme_id,
        "compid": serial,
        "comp_desc": theme_name,
        "bank": bank,
        "location": location,
        "brief_desc": brief,
        "work_desc": work_desc,
        "wo_type": _text(body.wo_type),
        "probtype": _text(body.probtype),
        "asst_dwn": asst_dwn,
        "game_oos": game_oos,
        "assignto": assignto,
        "assignid": assignid,
        "assigntype": assigntype,
        "adduser": adduser,
        "requestor": _text(body.requestor),
        "req_tele": _text(body.req_tele),
        "drivetime": drivetime,
        "workmhours": workmhours,
        "hours": hours,
        "date_wo": today,
        "adddate": today,
    }
    try:
        inserted = _insert_work_order_sql(sql_row)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                f"eMaint WO {assigned_wo} was created, but SQL insert failed: {exc}. "
                "Do not retry blindly — check projects.work_orders / eMaint."
            ),
        ) from exc

    return {
        "ok": True,
        "wo": _text(inserted.get("wo")) or str(assigned_wo),
        "reference_key": _text(inserted.get("reference_key")),
        "uuid": str(inserted.get("uuid")) if inserted.get("uuid") is not None else None,
        "property": property_name,
        "casino_id": casino_id,
        "compid": serial,
        "asset_id": asset_id,
        "brief_desc": brief,
        "date_wo": _day(inserted.get("date_wo")) or today,
        "workstatus": _text(inserted.get("workstatus")) or "O",
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
            wo.wo_type,
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


_PART_SEARCH_TOKEN = re.compile(r"[^a-zA-Z0-9._/-]+")

# Tech Order Form AppSheet Importance enum (AllowOtherValues=false).
_PART_REQUEST_IMPORTANCE = {
    "Cabinet Down - Urgent",
    "Cosmetic - High Priority",
    "Cosmetic - Low Priority",
}


def _appsheet_user_detail(exc: appsheet_client.AppSheetError, *, fallback: str) -> str:
    """Prefer AppSheet's validation message over a raw HTTP wrapper."""
    body = (exc.body or "").strip()
    if body:
        try:
            parsed = json.loads(body)
            if isinstance(parsed, dict) and parsed.get("detail"):
                return str(parsed["detail"]).strip()
        except Exception:
            pass
        if "invalid value" in body.lower() or "doesn't support value" in body.lower():
            return body[:500]
    msg = str(exc).strip()
    return f"{fallback}: {msg}" if msg else fallback


def _format_street_address(address: str, city: str, zip_code: Any, state: str = "") -> str:
    street = (address or "").strip()
    city_s = (city or "").strip()
    zip_s = str(zip_code or "").strip()
    state_s = (state or "").strip()
    locality = ", ".join(p for p in (city_s, state_s) if p)
    if locality and zip_s:
        locality = f"{locality} {zip_s}"
    elif zip_s:
        locality = zip_s
    return ", ".join(p for p in (street, locality) if p)


def _casino_ship_address(property_name: str | None) -> str:
    prop = (property_name or "").strip()
    if not prop:
        return ""
    rows = _query(
        """
        SELECT TOP 1
            c.address,
            c.city,
            c.zip,
            s.state_abbreviation AS state_abbr
        FROM clients.casinos AS c
        LEFT JOIN clients.states AS s ON s.reference_key = c.state_id
        WHERE c.emaint_property = %s
           OR c.casino_name = %s
           OR c.reference_key = %s
        """,
        (prop, prop, prop),
    )
    if not rows:
        return ""
    row = rows[0]
    return _format_street_address(
        _text(row.get("address")),
        _text(row.get("city")),
        row.get("zip"),
        _text(row.get("state_abbr")),
    )


def _resolve_tech_location(email: str, name: str) -> dict[str, str]:
    """Best-effort Locations row for ship-to / Tech Name."""
    email_l = (email or "").strip().lower()
    name_s = (name or "").strip()
    try:
        if email_l:
            safe = email_l.replace('"', "")
            rows = appsheet_client.find_rows(
                appsheet_client.LOCATIONS_TABLE,
                selector=(
                    f'TOP(FILTER({appsheet_client.LOCATIONS_TABLE}, '
                    f'FIND("{safe}", LOWER([Assigned User (Email)])) > 0), 5)'
                ),
            )
            if rows:
                row = rows[0]
                return {
                    "name": _text(row.get("Name")),
                    "address": _text(row.get("Tech Address")),
                    "initials": _text(row.get("Tech Initial")),
                }
        if name_s:
            safe = name_s.replace('"', "")
            rows = appsheet_client.find_rows(
                appsheet_client.LOCATIONS_TABLE,
                selector=(
                    f'FILTER({appsheet_client.LOCATIONS_TABLE}, '
                    f'[Name] = "{safe}")'
                ),
            )
            if rows:
                row = rows[0]
                return {
                    "name": _text(row.get("Name")),
                    "address": _text(row.get("Tech Address")),
                    "initials": _text(row.get("Tech Initial")),
                }
    except appsheet_client.AppSheetError:
        return {}
    return {}


def _map_part_request_job_type(wo_type: str | None) -> str:
    """Option 2: use Repair/Stock/Install when wo_type matches; else Repair."""
    raw = (wo_type or "").strip()
    if not raw:
        return "Repair"
    for allowed in _PART_REQUEST_JOB_TYPES:
        if raw.casefold() == allowed.casefold():
            return allowed
    return "Repair"


def _part_request_defaults(user: dict[str, Any] | None, row: dict[str, Any]) -> dict[str, Any]:
    """Prefill locked Tech Order context from WO + Locations."""
    user = user or {}
    tech_email = _text(user.get("email"))
    user_name = _text(user.get("name")) or ""
    loc = _resolve_tech_location(tech_email, user_name)
    tech_name = loc.get("name") or user_name
    asset = _text(row.get("serial")) or _text(row.get("compid"))
    wo_type = _text(row.get("wo_type"))
    casino_address = _casino_ship_address(_text(row.get("property")))
    tech_address = loc.get("address") or ""
    ship_to = "Primary Location" if tech_address else ("Casino" if casino_address else "Primary Location")
    return {
        "tech_name": tech_name,
        "job_type": _map_part_request_job_type(wo_type),
        "wo_type": wo_type,
        "asset_id": asset,
        "wo": _text(row.get("wo")),
        "project_no": _text(row.get("project_no")),
        "tech_address": tech_address,
        "casino_address": casino_address,
        "ship_to_category": ship_to,
        "send_to_address": tech_address if ship_to == "Primary Location" else casino_address,
    }


def _parts_search_selector(needle: str, limit: int) -> str:
    """Build an AppSheet Find selector that techs can actually use.

    AppSheet REST ``CONTAINS([Part Name], …)`` returns empty for this Parts
    table; ``FIND(token, LOWER(blob)) > 0`` works. Multi-word queries become
    AND'd tokens so ``AGS Button`` matches name/mfr/label/id fields.
    """
    cleaned = (needle or "").replace('"', "").replace("\\", "").strip()
    raw_tokens = [t for t in re.split(r"\s+", cleaned) if t]
    tokens: list[str] = []
    for raw in raw_tokens:
        tok = _PART_SEARCH_TOKEN.sub("", raw).lower()
        if len(tok) >= 2:
            tokens.append(tok)
        elif len(tok) == 1 and tokens:
            # Keep single-char add-ons only when paired with a longer token.
            tokens.append(tok)
    if not tokens:
        # Fall back to whole needle if stripping wiped tokens (e.g. "10867").
        fallback = _PART_SEARCH_TOKEN.sub("", cleaned).lower()
        if len(fallback) >= 2:
            tokens = [fallback]
    if not tokens:
        return f"TOP(FILTER({appsheet_client.PARTS_TABLE}, TRUE), {int(limit)})"

    blob = (
        "LOWER("
        '[Part ID (Key)] & " " & [Part Number] & " " & [Part Name] & " " & '
        '[Manufacturer] & " " & [MFR Part No.] & " " & [Type to Search] & " " & '
        '[Parts_Dropdown_Label] & " " & [Category] & " " & [Part Category]'
        ")"
    )
    conditions = [f'FIND("{tok}", {blob}) > 0' for tok in tokens[:6]]
    expr = conditions[0] if len(conditions) == 1 else f"AND({', '.join(conditions)})"
    return f"TOP(FILTER({appsheet_client.PARTS_TABLE}, {expr}), {int(limit)})"


def _part_catalog_row(row: dict[str, Any]) -> dict[str, Any] | None:
    item = _text(row.get("Part ID (Key)"))
    if not item:
        return None
    photo = _text(row.get("Photo"))
    return {
        "item": item,
        "name": _text(row.get("Part Name")),
        "mfr": _text(row.get("Manufacturer")),
        "mfr_part": _text(row.get("MFR Part No.")),
        "category": _text(row.get("Category")),
        "stock": _text(row.get("Stock")),
        "has_photo": bool(photo),
        "photo_required": not bool(photo),
    }


@router.get("/part-catalog/search")
def part_catalog_search(
    q: str = Query("", max_length=80),
    limit: int = Query(20, ge=1, le=50),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """Search AppSheet Parts (Tech app) for DGS Part # picker."""
    _require_part_request_write(user)
    needle = (q or "").strip()
    if len(needle) < 2:
        return {"q": needle or None, "parts": []}
    selector = _parts_search_selector(needle, limit)
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
        mapped = _part_catalog_row(row)
        if mapped:
            parts.append(mapped)
    return {"q": needle, "parts": parts, "count": len(parts)}


@router.get("/part-catalog/item")
def part_catalog_item(
    id: str = Query(..., min_length=1, max_length=80),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """Exact Parts catalog lookup — used to decide if Pics are required."""
    _require_part_request_write(user)
    part_id = (id or "").strip()
    if not part_id:
        raise HTTPException(status_code=400, detail="Part id is required")
    safe = part_id.replace('"', "")
    try:
        rows = appsheet_client.find_rows(
            appsheet_client.PARTS_TABLE,
            selector=(
                f'FILTER({appsheet_client.PARTS_TABLE}, '
                f'[Part ID (Key)] = "{safe}")'
            ),
        )
    except appsheet_client.AppSheetError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Part lookup failed: {exc}",
        ) from exc
    if not rows:
        return {"found": False, "item": part_id, "has_photo": False, "photo_required": True}
    mapped = _part_catalog_row(rows[0]) or {
        "item": part_id,
        "has_photo": False,
        "photo_required": True,
    }
    return {"found": True, **mapped}


def _part_request_is_active(status: str, status_2: str) -> bool:
    """Match AppSheet active Orders visibility (2026-10-27).

    Hide done: Status Cancelled, Status 2 Complete.
    Keep Tech Received Part (soft-complete — revisit later).
    """
    if (status or "").strip().casefold() == "cancelled":
        return False
    if (status_2 or "").strip().casefold() == "complete":
        return False
    return True


@router.get("/{wo}/part-requests")
def list_part_requests(
    wo: str,
    include_done: bool = Query(False),
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
    hidden = 0
    for r in rows:
        status = _text(r.get("Status"))
        status_2 = _text(r.get("Status 2"))
        active = _part_request_is_active(status, status_2)
        if not include_done and not active:
            hidden += 1
            continue
        out.append(
            {
                "tech_order": _text(r.get("Tech Order #")),
                "dgs_part": _text(r.get("DGS Part #")),
                "quantity": _text(r.get("Quantity")),
                "status": status,
                "status_2": status_2,
                "date": _text(r.get("Date")),
                "tech_name": _text(r.get("Tech Name")),
                "part_description": _text(r.get("Part Description"))
                or _text(r.get("Description")),
                "importance": _text(r.get("Importance")),
                "active": active,
            }
        )
    return {
        "wo": wo_num,
        "can_write": _can_write_part_requests(user),
        "include_done": include_done,
        "hidden_done": hidden,
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
    mfr_part = _text(part_rows[0].get("MFR Part No."))
    catalog_photo = _text(part_rows[0].get("Photo"))
    catalog_photo_2 = _text(part_rows[0].get("Photo 2"))
    part_description = (body.part_description or "").strip() or (part_name or "")
    if not part_description:
        raise HTTPException(status_code=400, detail="Description is required")
    if body.quantity is None or float(body.quantity) <= 0:
        raise HTTPException(status_code=400, detail="Quantity is required")

    # Locked: Job Type comes from WO wo_type map (Repair/Stock/Install or Repair).
    job_type = _map_part_request_job_type(_text(row.get("wo_type")))

    importance = (body.importance or "").strip()
    if job_type == "Repair":
        if not importance:
            raise HTTPException(status_code=400, detail="Importance is required for Repair")
        if importance not in _PART_REQUEST_IMPORTANCE:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Importance must be one of: "
                    + ", ".join(sorted(_PART_REQUEST_IMPORTANCE))
                ),
            )

    ship_to = (body.ship_to_category or "").strip()
    if ship_to not in _PART_REQUEST_SHIP_TO:
        raise HTTPException(
            status_code=400,
            detail="Ship To Category must be Primary Location, Casino, or Other",
        )

    pic_inputs = [p for p in (body.pics or []) if (p or "").strip()]
    if len(pic_inputs) > 3:
        raise HTTPException(status_code=400, detail="At most 3 pictures allowed")
    if not catalog_photo and not pic_inputs:
        raise HTTPException(
            status_code=400,
            detail=(
                "Pic is required — this part has no catalog photo "
                "(same rule as the Tech Order Form)."
            ),
        )
    pic_urls = [_store_part_request_pic(p) for p in pic_inputs]
    today = date.today().isoformat()
    tech_email = _text(user.get("email"))
    user_name = _text(user.get("name")) or "DGS App"
    loc = _resolve_tech_location(tech_email, user_name)
    tech_name = (body.tech_name or "").strip() or loc.get("name") or user_name
    if not tech_name:
        raise HTTPException(status_code=400, detail="Tech Name is required")
    initials = (loc.get("initials") or "").strip() or (
        "".join(p[0] for p in re.split(r"\s+", tech_name) if p).upper()[:3] or "DG"
    )
    tech_order = f"TO{initials}{uuid.uuid4().hex[:5].upper()}{wo_num}"

    asset = _text(row.get("serial")) or _text(row.get("compid"))
    if job_type == "Repair" and not asset:
        raise HTTPException(
            status_code=400,
            detail="Asset ID is required for Repair part requests",
        )

    casino_address = _casino_ship_address(_text(row.get("property")))
    tech_address = loc.get("address") or ""
    if ship_to == "Primary Location":
        send_to = (body.ship_to_address or "").strip() or tech_address
        if not send_to and casino_address:
            # Office / non-tech pilots often have no Locations row — fall back.
            ship_to = "Casino"
            send_to = casino_address
    elif ship_to == "Casino":
        send_to = (body.ship_to_address or "").strip() or casino_address
    else:
        send_to = (body.ship_to_address or "").strip() or tech_address or casino_address
    if not send_to:
        raise HTTPException(
            status_code=400,
            detail=(
                "No ship-to address found (tech Locations address or casino address). "
                "Pick Casino / Other or add your tech location in AppSheet."
            ),
        )

    payload = {
        "Tech Order #": tech_order,
        "Work Order #": wo_num,
        "DGS Part #": part_id,
        "Quantity": str(int(body.quantity) if float(body.quantity).is_integer() else body.quantity),
        "Status": "Open",
        "Status 2": "Open",
        "Date": today,
        "Tech Name": tech_name,
        "Job Type": job_type,
        "Part Description": part_description,
        "Entered By Email": tech_email or "",
        "Tech Email": tech_email or "",
        "Tech Initials": initials,
        "Ship To Catagory": ship_to,
        "Send to Address": send_to,
    }
    if asset:
        payload["Asset ID"] = asset
    if tech_address:
        payload["Tech Address"] = tech_address
    if casino_address:
        payload["Casino Address"] = casino_address
    if _text(row.get("project_no")):
        payload["Project #"] = _text(row.get("project_no"))
    if importance:
        payload["Importance"] = importance
    if mfr_part:
        payload["Manufacture Part #"] = mfr_part
    # Part Image drives AppSheet Pics Required_If; stamp catalog photo when present.
    if catalog_photo:
        # AppSheet Image fields via API expect a URL; relative Paths may not resolve.
        # Leave blank if we only have a relative Path — Pics rule uses ISBLANK([Part Image]).
        # When catalog has Photo, Pics are optional; blank Part Image would wrongly require Pics.
        # Prefer copying the relative path (native AppSheet shape) so ISBLANK is false.
        payload["Part Image"] = catalog_photo
    if catalog_photo_2:
        payload["Part Image 2"] = catalog_photo_2
    if body.notes and body.notes.strip():
        payload["Notes"] = body.notes.strip()
    pic_fields = ("Pics", "Pics 2", "Pics 3")
    for field_name, url in zip(pic_fields, pic_urls):
        payload[field_name] = url

    try:
        created = appsheet_client.add_rows(
            appsheet_client.TECH_ORDER_TABLE,
            [payload],
        )
    except appsheet_client.AppSheetError as exc:
        detail = _appsheet_user_detail(exc, fallback="Part request create failed")
        # AppSheet validation (bad enum, required field) → 400; transport → 502.
        status = 400 if exc.status_code and 400 <= exc.status_code < 500 else 502
        raise HTTPException(status_code=status, detail=detail) from exc

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
            "defaults": _part_request_defaults(user, row) if _can_write_part_requests(user) else {},
        },
    }
    if include_priority:
        detail["priority"] = _text(row.get("priority"))
    return detail
