"""FSR review case API — quiet-email deep link target for Confirm/Revoke/Clarify."""

from __future__ import annotations

import json
import os
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import dgs_fsr_review_permissions as perms
from app import mssql
from app.auth_deps import require_demo_user

router = APIRouter(prefix="/api/fsr-review", tags=["fsr-review"])


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


def _parse_json(raw: Any) -> Any:
    if raw is None:
        return None
    if isinstance(raw, (dict, list)):
        return raw
    text = str(raw).strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def _assert_read(user: dict[str, Any] | None) -> None:
    if user is None:
        return
    if not perms.can_read(user.get("permissions") or {}):
        raise HTTPException(status_code=403, detail="No access to FSR review")


def _assert_write(user: dict[str, Any] | None) -> None:
    if user is None:
        return
    if not perms.can_write(user.get("permissions") or {}):
        raise HTTPException(status_code=403, detail="No write access to FSR review")


def _actor(user: dict[str, Any] | None) -> str:
    if not user:
        return "system"
    return str(user.get("email") or user.get("name") or user.get("employee_id") or "unknown")


class ConfirmBody(BaseModel):
    form_values: dict[str, Any] = Field(default_factory=dict)


class ClarifyBody(BaseModel):
    note: str = Field(min_length=1, max_length=4000)


def _maybe_close_case(case_id: str) -> None:
    open_left = _query(
        """
        SELECT TOP (1) issue_id
        FROM projects.fsr_review_issue
        WHERE case_id = %s AND status = N'open'
        """,
        (case_id,),
    )
    if open_left:
        return
    _execute(
        """
        UPDATE projects.fsr_review_case
        SET status = N'closed', closed_at = SYSUTCDATETIME()
        WHERE case_id = %s AND status = N'open'
        """,
        (case_id,),
    )


@router.get("/permissions")
def fsr_review_permissions(
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
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
        SELECT case_id, project_number, ims_reference_key, gmail_message_id, thread_id,
               subject, gmail_from, workbook_name, status, created_at, closed_at
        FROM projects.fsr_review_case
        WHERE case_id = %s
        """,
        (case_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Case not found")
    case = {k: _json_value(v) for k, v in dict(rows[0]).items()}
    issues_raw = _query(
        """
        SELECT issue_id, case_id, issue_type, title, status, payload_json,
               form_values_json, clarify_note, decided_by, decided_at, created_at
        FROM projects.fsr_review_issue
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


@router.post("/issues/{issue_id}/confirm")
def confirm_issue(
    issue_id: str,
    body: ConfirmBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user)
    rows = _query(
        "SELECT issue_id, case_id, status FROM projects.fsr_review_issue WHERE issue_id = %s",
        (issue_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Issue not found")
    issue = dict(rows[0])
    if str(issue.get("status")) != "open":
        raise HTTPException(status_code=409, detail=f"Issue already {issue.get('status')}")
    _execute(
        """
        UPDATE projects.fsr_review_issue
        SET status = N'confirmed',
            form_values_json = %s,
            decided_by = %s,
            decided_at = SYSUTCDATETIME(),
            clarify_note = NULL
        WHERE issue_id = %s AND status = N'open'
        """,
        (json.dumps(body.form_values, ensure_ascii=True, default=str), _actor(user), issue_id),
    )
    case_id = str(issue["case_id"])
    _maybe_close_case(case_id)
    return {"ok": True, "issue_id": issue_id, "status": "confirmed"}


@router.post("/issues/{issue_id}/revoke")
def revoke_issue(
    issue_id: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user)
    rows = _query(
        "SELECT issue_id, case_id, status FROM projects.fsr_review_issue WHERE issue_id = %s",
        (issue_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Issue not found")
    issue = dict(rows[0])
    if str(issue.get("status")) != "open":
        raise HTTPException(status_code=409, detail=f"Issue already {issue.get('status')}")
    _execute(
        """
        UPDATE projects.fsr_review_issue
        SET status = N'revoked',
            decided_by = %s,
            decided_at = SYSUTCDATETIME()
        WHERE issue_id = %s AND status = N'open'
        """,
        (_actor(user), issue_id),
    )
    _maybe_close_case(str(issue["case_id"]))
    return {"ok": True, "issue_id": issue_id, "status": "revoked"}


@router.post("/issues/{issue_id}/clarify")
def clarify_issue(
    issue_id: str,
    body: ClarifyBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user)
    rows = _query(
        "SELECT issue_id, case_id, status FROM projects.fsr_review_issue WHERE issue_id = %s",
        (issue_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Issue not found")
    issue = dict(rows[0])
    if str(issue.get("status")) != "open":
        raise HTTPException(status_code=409, detail=f"Issue already {issue.get('status')}")
    note = body.note.strip()
    _execute(
        """
        UPDATE projects.fsr_review_issue
        SET status = N'clarify',
            clarify_note = %s,
            decided_by = %s,
            decided_at = SYSUTCDATETIME()
        WHERE issue_id = %s AND status = N'open'
        """,
        (note[:4000], _actor(user), issue_id),
    )
    _maybe_close_case(str(issue["case_id"]))
    return {"ok": True, "issue_id": issue_id, "status": "clarify"}
