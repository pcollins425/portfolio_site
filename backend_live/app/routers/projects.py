"""DGS Projects module API — calendar (projects.ims) + catalog (projects.project_catalog).

Read-only v1 (2026-07-09 plan):
  - GET /api/projects/calendar          — IMS schedule rows for a date window,
    grouped per day, with catalog cross-link ("Details Available")
  - GET /api/projects/catalog           — catalog headers (search + paging)
  - GET /api/projects/catalog/{ref}     — header + per-action line summary
  - GET /api/projects/catalog/{ref}/printout — projects.project_printout rows

The eMaint tab reuses /api/emaint-demo/projects/* (existing router).
"""

from __future__ import annotations

import math
import os
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app import mssql
from app import dgs_projects_permissions as perms
from app.auth_deps import require_demo_user

router = APIRouter(prefix="/api/projects", tags=["projects"])

PRINTOUT_COLUMNS = [
    "casino_name",
    "project_number",
    "zone",
    "bank",
    "location",
    "serial_number",
    "class",
    "theme_name",
    "vendor_name",
    "cabinet_type",
    "work_notes",
    "display_type",
    "program_storage",
    "paytable_id",
    "denom",
    "theo_inc_prog",
    "reels",
    "lines_or_ways",
    "bet_per_line",
    "max_coin_bet",
    "bet_multipliers",
    "progressive_level_count",
    "progressive_reset_1",
    "progressive_reset_2",
    "progressive_reset_3",
    "progressive_reset_4",
    "progressive_reset_5",
    "progressive_reset_6",
    "progressive_reset_7",
    "progressive_reset_8",
    "progressive_rate_1",
    "progressive_rate_2",
    "progressive_rate_3",
    "progressive_rate_4",
    "progressive_rate_5",
    "progressive_rate_6",
    "progressive_rate_7",
    "progressive_rate_8",
    "tribe_name",
]


def _catalog_db() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _query(sql: str, params=None) -> list[dict]:
    return mssql.query(
        sql,
        params=params,
        database=_catalog_db(),
        profile="field",
        load_env=False,
    )


def _json_value(v: Any):
    if isinstance(v, datetime):
        return v.isoformat(sep=" ")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if v is None:
        return None
    return str(v).strip() if isinstance(v, str) else v


def _date_only(v: Any) -> str | None:
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if v is None:
        return None
    return str(v)[:10]


def _assert_calendar(user: dict[str, Any] | None) -> None:
    if user is None:
        return
    if not perms.can_read_calendar(user.get("permissions") or {}):
        raise HTTPException(status_code=403, detail="No read access to projects calendar")


def _assert_catalog(user: dict[str, Any] | None) -> None:
    if user is None:
        return
    if not perms.can_read_catalog(user.get("permissions") or {}):
        raise HTTPException(status_code=403, detail="No read access to projects catalog")


@router.get("/permissions")
def projects_permissions(
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """Which Projects views the signed-in user can open (eMaint tab uses emaint_demo_projects)."""
    p = (user or {}).get("permissions") or {}
    open_access = user is None
    return {
        "calendar": open_access or perms.can_read_calendar(p),
        "catalog": open_access or perms.can_read_catalog(p),
        "emaint": open_access or (p.get("emaint_demo_projects") is not None),
    }


@router.get("/calendar")
def projects_calendar(
    start_date: str = Query(..., description="Window start YYYY-MM-DD"),
    end_date: str = Query(..., description="Window end YYYY-MM-DD"),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """IMS schedule rows overlapping [start_date, end_date], grouped per day.

    Ported from ERM projects_api_calendar: multi-day projects appear under every
    day they span inside the window; ``matching_catalog`` marks the catalog link
    (Details Available badge).
    """
    _assert_calendar(user)

    try:
        window_start = date.fromisoformat(start_date)
        window_end = date.fromisoformat(end_date)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD") from exc
    if window_end < window_start:
        raise HTTPException(status_code=400, detail="end_date before start_date")
    if (window_end - window_start).days > 190:
        raise HTTPException(status_code=400, detail="window too large (max ~6 months)")

    try:
        rows = _query(
            """
            SELECT
                ims.reference_key,
                ims.project_number,
                ims.start_date,
                ims.end_date,
                ims.status,
                ims.project_type,
                ims.description,
                ims.comments,
                ims.lead_tech,
                ims.assistant_techs,
                ims.casino_id,
                casinos.casino_name AS property,
                tribes.tribe_name AS tribe,
                states.state,
                pc.reference_key AS catalog_reference_key,
                pc.project_name AS catalog_project_name,
                pc.notes AS catalog_notes,
                (
                    SELECT COUNT(*)
                    FROM projects.project_details pd
                    WHERE pd.project_id = pc.reference_key
                ) AS catalog_line_count
            FROM projects.ims ims
            LEFT JOIN clients.casinos casinos ON ims.casino_id = casinos.reference_key
            LEFT JOIN clients.tribes tribes ON casinos.tribe_id = tribes.reference_key
            LEFT JOIN clients.states states ON casinos.state_id = states.reference_key
            LEFT JOIN projects.project_catalog pc ON pc.ims_id = ims.reference_key
            WHERE COALESCE(ims.start_date, '1900-01-01') <= %s
              AND COALESCE(ims.end_date, '2099-12-31') >= %s
            ORDER BY ims.start_date, ims.project_number
            """,
            (window_end.isoformat(), window_start.isoformat()),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    projects = []
    for r in rows:
        catalog_key = _json_value(r.get("catalog_reference_key"))
        projects.append(
            {
                "reference_key": _json_value(r.get("reference_key")),
                "project_no": r.get("project_number"),
                "date_start": _date_only(r.get("start_date")),
                "date_end": _date_only(r.get("end_date")),
                "status": _json_value(r.get("status")),
                "proj_type": _json_value(r.get("project_type")),
                "proj_desc": _json_value(r.get("description")),
                "comment": _json_value(r.get("comments")),
                "tech": _json_value(r.get("lead_tech")),
                "assisting": _json_value(r.get("assistant_techs")),
                "casino_id": _json_value(r.get("casino_id")),
                "property": _json_value(r.get("property")),
                "tribe": _json_value(r.get("tribe")),
                "state": _json_value(r.get("state")),
                "matching_catalog": (
                    {
                        "reference_key": catalog_key,
                        "project_name": _json_value(r.get("catalog_project_name")),
                        "line_count": int(r.get("catalog_line_count") or 0),
                        "notes": _json_value(r.get("catalog_notes")),
                    }
                    if catalog_key
                    else None
                ),
            }
        )

    projects_by_date: dict[str, list[dict]] = {}
    for project in projects:
        raw_start = project["date_start"]
        if not raw_start:
            continue
        try:
            span_start = date.fromisoformat(raw_start)
        except ValueError:
            continue
        span_end = span_start
        if project["date_end"]:
            try:
                span_end = date.fromisoformat(project["date_end"])
            except ValueError:
                span_end = span_start
        if span_end < span_start:
            span_end = span_start

        day = max(span_start, window_start)
        last = min(span_end, window_end)
        while day <= last:
            projects_by_date.setdefault(day.isoformat(), []).append(project)
            day += timedelta(days=1)

    return {
        "start_date": window_start.isoformat(),
        "end_date": window_end.isoformat(),
        "projects": projects,
        "projects_by_date": projects_by_date,
        "total": len(projects),
    }


@router.get("/catalog")
def catalog_list(
    q: str = Query("", max_length=120, description="Search name, IMS no., casino, status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """Catalog headers, newest first, with line counts."""
    _assert_catalog(user)

    search = q.strip()
    search_sql = ""
    search_params: tuple = ()
    if search:
        like = f"%{search}%"
        search_sql = """
            AND (
                pc.project_name LIKE %s
                OR pc.reference_key LIKE %s
                OR pc.ims_project_number LIKE %s
                OR c.casino_name LIKE %s
                OR pc.status LIKE %s
            )
        """
        search_params = (like, like, like, like, like)

    try:
        total = int(
            _query(
                f"""
                SELECT COUNT(*) AS n
                FROM projects.project_catalog pc
                LEFT JOIN clients.casinos c ON pc.casino_id = c.reference_key
                WHERE 1=1 {search_sql}
                """,
                search_params,
            )[0]["n"]
        )
        offset = (page - 1) * page_size
        rows = _query(
            f"""
            SELECT
                pc.reference_key,
                pc.project_name,
                pc.ims_project_number,
                pc.ims_id,
                pc.casino_id,
                c.casino_name,
                pc.project_type,
                pc.status,
                ps.status_name,
                pc.date_start,
                pc.date_end,
                pc.date_created,
                (
                    SELECT COUNT(*)
                    FROM projects.project_details pd
                    WHERE pd.project_id = pc.reference_key
                ) AS line_count
            FROM projects.project_catalog pc
            LEFT JOIN clients.casinos c ON pc.casino_id = c.reference_key
            LEFT JOIN projects.project_status ps ON pc.status = ps.status_code
            WHERE 1=1 {search_sql}
            ORDER BY pc.date_start DESC, pc.reference_key DESC
            OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY
            """,
            search_params,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    items = [
        {
            "reference_key": _json_value(r.get("reference_key")),
            "project_name": _json_value(r.get("project_name")),
            "ims_project_number": _json_value(r.get("ims_project_number")),
            "ims_id": _json_value(r.get("ims_id")),
            "casino_id": _json_value(r.get("casino_id")),
            "casino_name": _json_value(r.get("casino_name")),
            "project_type": _json_value(r.get("project_type")),
            "status": _json_value(r.get("status")),
            "status_name": _json_value(r.get("status_name")),
            "date_start": _date_only(r.get("date_start")),
            "date_end": _date_only(r.get("date_end")),
            "date_created": _date_only(r.get("date_created")),
            "line_count": int(r.get("line_count") or 0),
        }
        for r in rows
    ]
    return {
        "items": items,
        "search": search or None,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": max(1, math.ceil(total / page_size)) if total else 1,
    }


@router.get("/catalog/{reference_key}")
def catalog_detail(
    reference_key: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """Catalog header + IMS link + action mix summary."""
    _assert_catalog(user)

    key = reference_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="reference_key is required")

    try:
        header_rows = _query(
            """
            SELECT
                pc.uuid,
                pc.reference_key,
                pc.project_name,
                pc.folder_name,
                pc.ims_project_number,
                pc.ims_id,
                pc.casino_id,
                c.casino_name,
                t.tribe_name,
                pc.project_type,
                pc.status,
                ps.status_name,
                pc.created_by,
                pc.assigned_to,
                pc.date_created,
                pc.date_start,
                pc.date_end,
                pc.description,
                pc.notes,
                pc.update_by,
                pc.update_date,
                ims.status AS ims_status,
                ims.lead_tech AS ims_lead_tech,
                ims.assistant_techs AS ims_assistant_techs,
                ims.description AS ims_description
            FROM projects.project_catalog pc
            LEFT JOIN clients.casinos c ON pc.casino_id = c.reference_key
            LEFT JOIN clients.tribes t ON c.tribe_id = t.reference_key
            LEFT JOIN projects.project_status ps ON pc.status = ps.status_code
            LEFT JOIN projects.ims ims ON ims.reference_key = pc.ims_id
            WHERE pc.reference_key = %s
            """,
            (key,),
        )
        if not header_rows:
            raise HTTPException(status_code=404, detail=f"project not found: {key!r}")

        action_rows = _query(
            """
            SELECT
                pd.action_type,
                at.action_name,
                COUNT(*) AS line_count
            FROM projects.project_details pd
            LEFT JOIN projects.action_types at ON at.action_code = pd.action_type
            WHERE pd.project_id = %s
            GROUP BY pd.action_type, at.action_name
            ORDER BY COUNT(*) DESC
            """,
            (key,),
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    h = header_rows[0]
    actions = [
        {
            "action_type": _json_value(r.get("action_type")),
            "action_name": _json_value(r.get("action_name")),
            "line_count": int(r.get("line_count") or 0),
        }
        for r in action_rows
    ]
    return {
        "reference_key": _json_value(h.get("reference_key")),
        "project_name": _json_value(h.get("project_name")),
        "folder_name": _json_value(h.get("folder_name")),
        "ims_project_number": _json_value(h.get("ims_project_number")),
        "ims_id": _json_value(h.get("ims_id")),
        "casino_id": _json_value(h.get("casino_id")),
        "casino_name": _json_value(h.get("casino_name")),
        "tribe_name": _json_value(h.get("tribe_name")),
        "project_type": _json_value(h.get("project_type")),
        "status": _json_value(h.get("status")),
        "status_name": _json_value(h.get("status_name")),
        "created_by": _json_value(h.get("created_by")),
        "assigned_to": _json_value(h.get("assigned_to")),
        "date_created": _date_only(h.get("date_created")),
        "date_start": _date_only(h.get("date_start")),
        "date_end": _date_only(h.get("date_end")),
        "description": _json_value(h.get("description")),
        "notes": _json_value(h.get("notes")),
        "update_by": _json_value(h.get("update_by")),
        "update_date": _json_value(h.get("update_date")),
        "ims_status": _json_value(h.get("ims_status")),
        "ims_lead_tech": _json_value(h.get("ims_lead_tech")),
        "ims_assistant_techs": _json_value(h.get("ims_assistant_techs")),
        "ims_description": _json_value(h.get("ims_description")),
        "actions": actions,
        "line_count": sum(a["line_count"] for a in actions),
    }


@router.get("/catalog/{reference_key}/printout")
def catalog_printout(
    reference_key: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """Commission-facing printout rows (projects.project_printout) for one project."""
    _assert_catalog(user)

    key = reference_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="reference_key is required")

    select_list = ", ".join(f"[{c}]" for c in PRINTOUT_COLUMNS)
    try:
        rows = _query(
            f"""
            SELECT {select_list}
            FROM projects.project_printout
            WHERE project_catalog_reference_key = %s
            ORDER BY work_notes, location, serial_number
            """,
            (key,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    out_rows = [{c: _json_value(r.get(c)) for c in PRINTOUT_COLUMNS} for r in rows]
    return {
        "reference_key": key,
        "columns": PRINTOUT_COLUMNS,
        "rows": out_rows,
        "total": len(out_rows),
    }
