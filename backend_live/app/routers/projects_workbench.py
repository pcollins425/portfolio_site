"""Project Workbench API — proposals (fluid early carrier) list + detail + readiness."""

from __future__ import annotations

import json
import os
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app import dgs_projects_workbench_permissions as perms
from app import mssql
from app.auth_deps import require_demo_user

router = APIRouter(prefix="/api/projects-workbench", tags=["projects-workbench"])

STAGES = frozenset(
    {"draft", "pre_check", "final_approved", "worksheet_issued", "done"}
)
CHECK_STATUSES = frozenset(
    {"pending", "in_progress", "blocker", "ready", "na"}
)
OPS = frozenset({"convert", "install", "remove", "move"})


def _db() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _query(sql: str, params=None) -> list[dict]:
    return mssql.query(sql, params=params, database=_db(), profile="field", load_env=False)


def _execute(sql: str, params=None) -> int:
    return mssql.execute(sql, params=params, database=_db(), profile="field", load_env=False)


def _json_value(v: Any):
    if isinstance(v, datetime):
        return v.isoformat(sep=" ")
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, UUID):
        return str(v)
    if v is None:
        return None
    return str(v).strip() if isinstance(v, str) else v


def _row(d: dict) -> dict:
    return {k: _json_value(v) for k, v in d.items()}


def _assert_read(user: dict[str, Any] | None) -> None:
    if user is None:
        return
    if not perms.can_read(user.get("permissions") or {}):
        raise HTTPException(status_code=403, detail="No access to Project Workbench")


def _assert_write(user: dict[str, Any] | None) -> None:
    if user is None:
        return
    if not perms.can_write(user.get("permissions") or {}):
        raise HTTPException(status_code=403, detail="No write access to Project Workbench")


def _actor(user: dict[str, Any] | None) -> str:
    if not user:
        return "system"
    return str(user.get("email") or user.get("name") or user.get("employee_id") or "unknown")[:50]


def _tbd_theme_id() -> str:
    rows = _query(
        """
        SELECT config_value
        FROM projects.proposal_config
        WHERE config_key = N'tbd_theme_id'
        """
    )
    if not rows:
        raise HTTPException(status_code=500, detail="TBD theme config missing")
    return str(rows[0]["config_value"])


def _refresh_readiness(proposal_id: str) -> None:
    _execute(
        """
        UPDATE p
        SET version_readiness = v.computed_version_readiness,
            update_date = SYSUTCDATETIME()
        FROM projects.proposal p
        JOIN projects.vw_proposal_version_blockers v ON v.proposal_id = p.uuid
        WHERE p.uuid = %s
        """,
        (proposal_id,),
    )


def _get_proposal(ref_or_id: str) -> dict:
    key = ref_or_id.strip()
    rows = _query(
        """
        SELECT TOP (1)
            p.uuid, p.reference_key, p.casino_id, p.kind, p.version_num, p.stage,
            p.grace_months, p.project_date, p.locked_at, p.locked_by,
            p.version_readiness, p.notes, p.discussion,
            p.insert_date, p.update_date, p.update_by, p.change_log,
            c.casino_name, c.casino_short, c.casino_abbreviation,
            v.has_tbd_theme, v.open_check_count, v.computed_version_readiness
        FROM projects.proposal p
        LEFT JOIN clients.casinos c ON c.reference_key = p.casino_id
        LEFT JOIN projects.vw_proposal_version_blockers v ON v.proposal_id = p.uuid
        WHERE p.reference_key = %s OR CAST(p.uuid AS nvarchar(36)) = %s
        """,
        (key, key),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return rows[0]


@router.get("/permissions")
def workbench_permissions(
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    perms_map = (user or {}).get("permissions") or {}
    return {
        "can_read": perms.can_read(perms_map) if user else True,
        "can_write": perms.can_write(perms_map) if user else True,
        "area": perms.WORKBENCH_AREA,
        "tbd_theme_id": _tbd_theme_id(),
    }


@router.get("/proposals")
def list_proposals(
    casino_id: str | None = Query(None, max_length=25),
    stage: str | None = Query(None, max_length=30),
    q: str = Query("", max_length=120),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user)
    where = ["1=1"]
    params: list[Any] = []
    if casino_id and casino_id.strip():
        where.append("p.casino_id = %s")
        params.append(casino_id.strip())
    if stage and stage.strip():
        if stage.strip() not in STAGES:
            raise HTTPException(status_code=400, detail=f"Invalid stage: {stage}")
        where.append("p.stage = %s")
        params.append(stage.strip())
    search = q.strip()
    if search:
        like = f"%{search}%"
        where.append(
            """(
                p.reference_key LIKE %s
                OR c.casino_name LIKE %s
                OR c.casino_short LIKE %s
                OR p.notes LIKE %s
            )"""
        )
        params.extend([like, like, like, like])

    where_sql = " AND ".join(where)
    total = int(
        _query(
            f"""
            SELECT COUNT(*) AS n
            FROM projects.proposal p
            LEFT JOIN clients.casinos c ON c.reference_key = p.casino_id
            WHERE {where_sql}
            """,
            tuple(params),
        )[0]["n"]
    )
    offset = (page - 1) * page_size
    rows = _query(
        f"""
        SELECT
            p.uuid, p.reference_key, p.casino_id, p.kind, p.version_num, p.stage,
            p.version_readiness, p.grace_months, p.update_date,
            c.casino_name, c.casino_short,
            v.has_tbd_theme, v.open_check_count, v.computed_version_readiness,
            (SELECT COUNT(*) FROM projects.proposal_unit u WHERE u.proposal_id = p.uuid) AS unit_count
        FROM projects.proposal p
        LEFT JOIN clients.casinos c ON c.reference_key = p.casino_id
        LEFT JOIN projects.vw_proposal_version_blockers v ON v.proposal_id = p.uuid
        WHERE {where_sql}
        ORDER BY p.update_date DESC, p.reference_key DESC
        OFFSET %s ROWS FETCH NEXT %s ROWS ONLY
        """,
        tuple(params + [offset, page_size]),
    )
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [_row(r) for r in rows],
    }


@router.get("/proposals/{ref}")
def proposal_detail(
    ref: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user)
    p = _get_proposal(ref)
    pid = str(p["uuid"])
    tbd = _tbd_theme_id()
    units = _query(
        """
        SELECT
            u.uuid, u.reference_key, u.sort_order, u.op, u.serial,
            u.asset_id, u.cabinet_id, u.current_theme_id, u.proposed_theme_id,
            u.zone, u.bank, u.location, u.bank_group,
            u.flag_reasons_json, u.rejected_themes_json,
            ct.theme_name AS current_theme_name,
            pt.theme_name AS proposed_theme_name,
            cab.cabinet_name,
            CASE WHEN u.proposed_theme_id = %s THEN 1 ELSE 0 END AS is_tbd
        FROM projects.proposal_unit u
        LEFT JOIN vendors.themes ct ON ct.reference_key = u.current_theme_id
        LEFT JOIN vendors.themes pt ON pt.reference_key = u.proposed_theme_id
        LEFT JOIN vendors.cabinets cab ON cab.reference_key = u.cabinet_id
        WHERE u.proposal_id = %s
        ORDER BY u.sort_order, u.reference_key
        """,
        (tbd, pid),
    )
    checks = _query(
        """
        SELECT
            c.uuid, c.proposal_unit_id, c.check_type, c.status, c.owner_role,
            c.notes, c.update_by, c.update_date,
            u.serial, u.sort_order, u.proposed_theme_id,
            t.theme_name AS proposed_theme_name
        FROM projects.proposal_readiness_check c
        JOIN projects.proposal_unit u ON u.uuid = c.proposal_unit_id
        LEFT JOIN vendors.themes t ON t.reference_key = u.proposed_theme_id
        WHERE c.proposal_id = %s
        ORDER BY u.sort_order, c.check_type
        """,
        (pid,),
    )
    history = _query(
        """
        SELECT TOP (50)
            h.uuid, h.event_at, h.actor, h.event_type,
            h.from_stage, h.to_stage, h.from_version, h.to_version, h.detail_json
        FROM projects.proposal_history h
        WHERE h.proposal_id = %s
        ORDER BY h.event_at DESC
        """,
        (pid,),
    )
    for u in units:
        raw = u.get("flag_reasons_json")
        if isinstance(raw, str) and raw.strip():
            try:
                u["flag_reasons"] = json.loads(raw)
            except json.JSONDecodeError:
                u["flag_reasons"] = [raw]
        else:
            u["flag_reasons"] = []
    return {
        "proposal": _row(p),
        "tbd_theme_id": tbd,
        "units": [_row(u) for u in units],
        "checks": [_row(c) for c in checks],
        "history": [_row(h) for h in history],
    }


class UnitPatch(BaseModel):
    op: str | None = None
    serial: str | None = None
    proposed_theme_id: str | None = None
    current_theme_id: str | None = None
    zone: str | None = None
    bank: str | None = None
    location: str | None = None


class CheckPatch(BaseModel):
    status: str | None = None
    notes: str | None = None
    owner_role: str | None = None


class StageBody(BaseModel):
    stage: Literal["draft", "pre_check"]
    reason: str | None = Field(None, max_length=2000)


@router.patch("/units/{unit_id}")
def patch_unit(
    unit_id: str,
    body: UnitPatch,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user)
    rows = _query(
        """
        SELECT u.uuid, u.proposal_id, p.stage, p.reference_key
        FROM projects.proposal_unit u
        JOIN projects.proposal p ON p.uuid = u.proposal_id
        WHERE u.uuid = %s
        """,
        (unit_id.strip(),),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Unit not found")
    row = rows[0]
    if row["stage"] not in ("draft", "pre_check"):
        raise HTTPException(status_code=400, detail="Units locked at this stage")

    sets: list[str] = ["update_date = SYSUTCDATETIME()", "update_by = %s"]
    params: list[Any] = [_actor(user)]

    if body.op is not None:
        op = body.op.strip().lower()
        if op not in OPS:
            raise HTTPException(status_code=400, detail=f"Invalid op: {op}")
        sets.append("op = %s")
        params.append(op)
    if body.serial is not None:
        sets.append("serial = %s")
        params.append(body.serial.strip() or None)
    if body.proposed_theme_id is not None:
        tid = body.proposed_theme_id.strip()
        exists = _query(
            "SELECT TOP 1 reference_key FROM vendors.themes WHERE reference_key = %s",
            (tid,),
        )
        if not exists:
            raise HTTPException(status_code=400, detail="Unknown proposed_theme_id")
        sets.append("proposed_theme_id = %s")
        params.append(tid)
    if body.current_theme_id is not None:
        tid = body.current_theme_id.strip()
        if tid:
            exists = _query(
                "SELECT TOP 1 reference_key FROM vendors.themes WHERE reference_key = %s",
                (tid,),
            )
            if not exists:
                raise HTTPException(status_code=400, detail="Unknown current_theme_id")
            sets.append("current_theme_id = %s")
            params.append(tid)
        else:
            sets.append("current_theme_id = NULL")
    if body.zone is not None:
        sets.append("zone = %s")
        params.append(body.zone.strip() or None)
    if body.bank is not None:
        sets.append("bank = %s")
        params.append(body.bank.strip() or None)
    if body.location is not None:
        sets.append("location = %s")
        params.append(body.location.strip() or None)

    if len(sets) == 2:
        raise HTTPException(status_code=400, detail="No fields to update")

    params.append(unit_id.strip())
    _execute(
        f"UPDATE projects.proposal_unit SET {', '.join(sets)} WHERE uuid = %s",
        tuple(params),
    )
    _refresh_readiness(str(row["proposal_id"]))
    return proposal_detail(str(row["reference_key"]), user)


@router.patch("/checks/{check_id}")
def patch_check(
    check_id: str,
    body: CheckPatch,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user)
    rows = _query(
        """
        SELECT c.uuid, c.proposal_id, p.stage, p.reference_key
        FROM projects.proposal_readiness_check c
        JOIN projects.proposal p ON p.uuid = c.proposal_id
        WHERE c.uuid = %s
        """,
        (check_id.strip(),),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Check not found")
    row = rows[0]
    if row["stage"] not in ("draft", "pre_check"):
        raise HTTPException(status_code=400, detail="Checks locked at this stage")

    sets: list[str] = ["update_date = SYSUTCDATETIME()", "update_by = %s"]
    params: list[Any] = [_actor(user)]
    if body.status is not None:
        st = body.status.strip().lower()
        if st not in CHECK_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status: {st}")
        sets.append("status = %s")
        params.append(st)
    if body.notes is not None:
        sets.append("notes = %s")
        params.append(body.notes.strip() or None)
    if body.owner_role is not None:
        role = body.owner_role.strip().lower()
        if role not in ("ops", "compliance"):
            raise HTTPException(status_code=400, detail="owner_role must be ops|compliance")
        sets.append("owner_role = %s")
        params.append(role)
    if len(sets) == 2:
        raise HTTPException(status_code=400, detail="No fields to update")

    params.append(check_id.strip())
    _execute(
        f"UPDATE projects.proposal_readiness_check SET {', '.join(sets)} WHERE uuid = %s",
        tuple(params),
    )
    _refresh_readiness(str(row["proposal_id"]))
    return proposal_detail(str(row["reference_key"]), user)


@router.post("/proposals/{ref}/stage")
def set_stage(
    ref: str,
    body: StageBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user)
    p = _get_proposal(ref)
    current = str(p["stage"])
    target = body.stage
    if current == target:
        return proposal_detail(str(p["reference_key"]), user)

    allowed = {
        ("draft", "pre_check"),
        ("pre_check", "draft"),
    }
    if (current, target) not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot move {current} → {target} (slice-1 allows draft↔pre_check only)",
        )
    if target == "draft" and current == "pre_check":
        if not (body.reason or "").strip():
            raise HTTPException(status_code=400, detail="Return to draft requires a reason")

    actor = _actor(user)
    pid = str(p["uuid"])
    _execute(
        """
        UPDATE projects.proposal
        SET stage = %s, update_date = SYSUTCDATETIME(), update_by = %s
        WHERE uuid = %s
        """,
        (target, actor, pid),
    )
    detail = {"reason": (body.reason or "").strip() or None}
    _execute(
        """
        INSERT INTO projects.proposal_history (
            uuid, event_at, actor, proposal_id, event_type,
            from_stage, to_stage, to_version, detail_json
        ) VALUES (
            NEWID(), SYSUTCDATETIME(), %s, %s, N'stage_move',
            %s, %s, %s, %s
        )
        """,
        (
            actor,
            pid,
            current,
            target,
            int(p["version_num"] or 1),
            json.dumps(detail),
        ),
    )
    _refresh_readiness(pid)
    return proposal_detail(str(p["reference_key"]), user)


@router.get("/themes")
def theme_search(
    q: str = Query("", max_length=120),
    limit: int = Query(30, ge=1, le=100),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """Theme picker — excludes TBD sentinel."""
    _assert_read(user)
    tbd = _tbd_theme_id()
    search = q.strip()
    if not search:
        return {"items": [], "tbd_theme_id": tbd}
    like = f"%{search}%"
    rows = _query(
        f"""
        SELECT TOP ({int(limit)})
            t.reference_key, t.theme_name, t.vendor_id, t.cabinet_id,
            v.vendor_name, c.cabinet_name
        FROM vendors.themes t
        LEFT JOIN vendors.vendors v ON v.reference_key = t.vendor_id
        LEFT JOIN vendors.cabinets c ON c.reference_key = t.cabinet_id
        WHERE t.reference_key <> %s
          AND (t.delete_request IS NULL OR LTRIM(RTRIM(t.delete_request)) = N'')
          AND (
                t.theme_name LIKE %s
             OR t.reference_key LIKE %s
          )
        ORDER BY t.theme_name
        """,
        (tbd, like, like),
    )
    return {"items": [_row(r) for r in rows], "tbd_theme_id": tbd}
