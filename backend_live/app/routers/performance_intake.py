"""Performance intake confirm API — email deep link only (no app nav tab)."""

from __future__ import annotations

import json
import os
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import dgs_performance_intake_permissions as perms
from app import mssql
from app.auth_deps import require_demo_user

router = APIRouter(prefix="/api/performance-intake", tags=["performance-intake"])


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
    return v


def _parse_json(raw: Any) -> Any:
    if raw is None or raw == "":
        return {}
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return {}


def _assert_read(user: dict | None) -> None:
    if user is None:
        return
    if not perms.can_read((user or {}).get("permissions") or {}):
        raise HTTPException(status_code=403, detail="performance intake read denied")


def _assert_write(user: dict | None) -> None:
    if user is None:
        return
    if not perms.can_write((user or {}).get("permissions") or {}):
        raise HTTPException(status_code=403, detail="performance intake write denied")


def _actor(user: dict | None) -> str | None:
    if not user:
        return None
    return (user.get("email") or user.get("name") or "")[:120] or None


class ConfirmBody(BaseModel):
    casino_short: str = Field(min_length=1, max_length=120)
    month_end: str = Field(min_length=8, max_length=32)
    note: str | None = None


class RevokeBody(BaseModel):
    note: str | None = None


@router.get("/permissions")
def permissions(user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None):
    p = (user or {}).get("permissions") or {}
    return {
        "can_read": True if user is None else perms.can_read(p),
        "can_write": True if user is None else perms.can_write(p),
    }


@router.get("/cases/{case_id}")
def get_case(
    case_id: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user)
    rows = _query(
        """
        SELECT case_id, gmail_message_id, thread_id, mailbox, subject, gmail_from, gmail_to,
               temp_path, proposed_casino_short, proposed_month_end,
               confirmed_casino_short, confirmed_month_end, dest_path,
               status, payload_json, created_at, closed_at, decided_by, decided_at
        FROM revenue.performance_intake_case
        WHERE case_id = %s
        """,
        (case_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Case not found")
    case = {k: _json_value(v) for k, v in dict(rows[0]).items()}
    case["payload"] = _parse_json(case.pop("payload_json", None))
    issues_raw = _query(
        """
        SELECT issue_id, case_id, issue_type, title, status, payload_json,
               form_values_json, clarify_note, decided_by, decided_at, created_at
        FROM revenue.performance_intake_issue
        WHERE case_id = %s
        ORDER BY created_at, issue_type
        """,
        (case_id,),
    )
    issues = []
    for raw in issues_raw:
        item = {k: _json_value(v) for k, v in dict(raw).items()}
        item["payload"] = _parse_json(item.pop("payload_json", None))
        item["form_values"] = _parse_json(item.pop("form_values_json", None))
        issues.append(item)
    case["issues"] = issues
    return case


@router.post("/cases/{case_id}/confirm")
def confirm_case(
    case_id: str,
    body: ConfirmBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user)
    case = get_case(case_id, user=user)
    if case.get("status") != "open":
        raise HTTPException(status_code=409, detail=f"Case status is {case.get('status')}")
    try:
        month = date.fromisoformat(body.month_end[:10])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid month_end: {e}") from e

    actor = _actor(user)
    form = {
        "casino_short": body.casino_short.strip(),
        "month_end": month.isoformat(),
        "note": body.note,
    }
    n = _execute(
        """
        UPDATE revenue.performance_intake_case
        SET confirmed_casino_short = %s,
            confirmed_month_end = %s,
            status = N'confirmed',
            decided_by = %s,
            decided_at = SYSUTCDATETIME(),
            closed_at = SYSUTCDATETIME()
        WHERE case_id = %s AND status = N'open'
        """,
        (form["casino_short"], month, actor, case_id),
    )
    if not n:
        raise HTTPException(status_code=409, detail="Case not updated")
    _execute(
        """
        UPDATE revenue.performance_intake_issue
        SET status = N'confirmed',
            form_values_json = %s,
            decided_by = %s,
            decided_at = SYSUTCDATETIME()
        WHERE case_id = %s AND status = N'open'
        """,
        (json.dumps(form), actor, case_id),
    )
    return get_case(case_id, user=user)


@router.post("/cases/{case_id}/revoke")
def revoke_case(
    case_id: str,
    body: RevokeBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user)
    case = get_case(case_id, user=user)
    if case.get("status") != "open":
        raise HTTPException(status_code=409, detail=f"Case status is {case.get('status')}")
    actor = _actor(user)
    _execute(
        """
        UPDATE revenue.performance_intake_case
        SET status = N'revoked',
            decided_by = %s,
            decided_at = SYSUTCDATETIME(),
            closed_at = SYSUTCDATETIME()
        WHERE case_id = %s AND status = N'open'
        """,
        (actor, case_id),
    )
    _execute(
        """
        UPDATE revenue.performance_intake_issue
        SET status = N'revoked',
            clarify_note = %s,
            decided_by = %s,
            decided_at = SYSUTCDATETIME()
        WHERE case_id = %s AND status = N'open'
        """,
        ((body.note or "")[:2000] or None, actor, case_id),
    )
    return get_case(case_id, user=user)
