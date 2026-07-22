"""FSR review case API — quiet-email deep link target for Confirm/Revoke/Clarify/Apply."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import dgs_fsr_review_permissions as perms
from app import mssql
from app.auth_deps import require_demo_user

router = APIRouter(prefix="/api/fsr-review", tags=["fsr-review"])

APPLYABLE_TYPES = frozenset({"asset_numbers", "footer_settings"})


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


class ConfirmBody(BaseModel):
    form_values: dict[str, Any] = Field(default_factory=dict)


class ClarifyBody(BaseModel):
    note: str = Field(min_length=1, max_length=4000)


class ApplyBody(BaseModel):
    dry_run: bool = True


def _case_apply_eligible(case: dict[str, Any], issues: list[dict[str, Any]]) -> tuple[bool, str]:
    if str(case.get("status") or "").lower() != "closed":
        return False, f"case status is {case.get('status')!r} (need closed)"
    apply_status = str(case.get("apply_status") or "none").lower()
    if apply_status in ("applied", "running"):
        return False, f"apply_status is {apply_status!r}"
    for issue in issues:
        if str(issue.get("status") or "").lower() != "confirmed":
            continue
        if str(issue.get("issue_type") or "") not in APPLYABLE_TYPES:
            continue
        form = issue.get("form_values") or {}
        if not isinstance(form, dict):
            continue
        for row in form.get("rows") or []:
            if not isinstance(row, dict):
                continue
            if str(row.get("asset") or "").strip():
                return True, "ok"
            if row.get("extras"):
                return True, "ok"
    return False, "no confirmed asset_numbers / footer_settings with values"


def _resolve_apply_root() -> str:
    root = (os.environ.get("FSR_APPLY_ROOT") or "").strip()
    if root and Path(root).is_dir():
        return root
    # Walk parents looking for a sibling/checkout named cursor_assistant
    # (path depth differs: local WSL vs Docker /app/app/routers/...).
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "cursor_assistant"
        if candidate.is_dir() and (candidate / "scripts" / "fsr_intake").is_dir():
            return str(candidate)
    alt = Path("/mnt/c/users/Paul Collins/cursor_assistant")
    if alt.is_dir() and (alt / "scripts" / "fsr_intake").is_dir():
        return str(alt)
    return ""


def _run_apply_subprocess(case_id: str, *, dry_run: bool, actor: str) -> dict[str, Any]:
    root = _resolve_apply_root()
    if not root:
        cli = (
            f"python3 -m scripts.fsr_intake.apply_from_review --case-id {case_id} "
            + ("--dry-run" if dry_run else "--apply")
        )
        raise HTTPException(
            status_code=503,
            detail=(
                "FSR apply tooling not available in this API container. "
                "Set FSR_APPLY_ROOT to a cursor_assistant checkout that includes "
                "scripts/fsr_intake, or run locally: "
                + cli
            ),
        )
    if not dry_run and (os.environ.get("FSR_APPLY_LIVE") or "").strip().lower() not in (
        "1",
        "true",
        "yes",
    ):
        raise HTTPException(
            status_code=403,
            detail="Live apply disabled — set FSR_APPLY_LIVE=1 to enable",
        )

    cmd = [
        sys.executable,
        "-m",
        "scripts.fsr_intake.apply_from_review",
        "--case-id",
        case_id,
        "--applied-by",
        actor,
        "--json",
    ]
    if dry_run:
        cmd.append("--dry-run")
    else:
        cmd.append("--apply")

    proc = subprocess.run(
        cmd,
        cwd=root,
        capture_output=True,
        text=True,
        env=os.environ.copy(),
        timeout=int(os.environ.get("FSR_APPLY_TIMEOUT_SEC") or "600"),
    )
    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()
    parsed: dict[str, Any] | None = None
    if stdout:
        try:
            parsed = json.loads(stdout)
        except json.JSONDecodeError:
            parsed = None
    if proc.returncode != 0:
        raise HTTPException(
            status_code=500,
            detail={
                "message": "apply_from_review failed",
                "returncode": proc.returncode,
                "stderr": stderr[-2000:],
                "stdout": stdout[-2000:],
                "result": parsed,
            },
        )
    return parsed or {"ok": True, "raw_stdout": stdout[-2000:]}


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
               subject, gmail_from, workbook_name, status, created_at, closed_at,
               apply_status, applied_at, applied_by, apply_overlay_json, apply_log_json
        FROM projects.fsr_review_case
        WHERE case_id = %s
        """,
        (case_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Case not found")
    case = {k: _json_value(v) for k, v in dict(rows[0]).items()}
    case["apply_overlay"] = _parse_json(case.pop("apply_overlay_json", None))
    case["apply_log"] = _parse_json(case.pop("apply_log_json", None))
    if case.get("apply_status") is None:
        case["apply_status"] = "none"
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
    eligible, reason = _case_apply_eligible(case, issues)
    case["apply_eligible"] = eligible
    case["apply_eligible_reason"] = reason
    return case


@router.post("/cases/{case_id}/apply")
def apply_case(
    case_id: str,
    body: ApplyBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user)
    case = get_case(case_id, user=user)
    if not case.get("apply_eligible"):
        raise HTTPException(
            status_code=409,
            detail=case.get("apply_eligible_reason") or "Case not eligible to apply",
        )
    actor = _actor(user)
    result = _run_apply_subprocess(case_id, dry_run=body.dry_run, actor=actor)
    refreshed = get_case(case_id, user=user)
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "result": result,
        "case": refreshed,
    }


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
