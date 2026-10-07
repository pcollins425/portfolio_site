"""Mail Intake API — dual mailbox queue, manual designate, process enqueue."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app import dgs_mail_intake_permissions as perms
from app import mail_intake as mi
from app.auth_deps import require_demo_user

router = APIRouter(prefix="/api/mail-intake", tags=["mail-intake"])


def _assert_read(user: dict | None) -> None:
    if user is None:
        return
    if not perms.can_read((user or {}).get("permissions") or {}):
        raise HTTPException(status_code=403, detail="No dgs_mail_intake read access")


def _assert_write(user: dict | None) -> None:
    if user is None:
        return
    if not perms.can_write((user or {}).get("permissions") or {}):
        raise HTTPException(status_code=403, detail="No dgs_mail_intake write access")


def _actor(user: dict | None) -> str:
    if not user:
        return "local"
    return (user.get("email") or user.get("name") or "unknown")[:120]


class DesignateBody(BaseModel):
    uuids: list[str] = Field(min_length=1, max_length=200)
    designation: str


class ProcessBody(BaseModel):
    uuids: list[str] = Field(min_length=1, max_length=50)


@router.get("/permissions")
def permissions(user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None):
    p = (user or {}).get("permissions") or {}
    return {
        "can_read": True if user is None else perms.can_read(p),
        "can_write": True if user is None else perms.can_write(p),
        "unset_count": mi.count_unset() if (user is None or perms.can_read(p)) else 0,
    }


@router.get("")
def list_mail(
    designation: str | None = Query(None),
    mailbox: str | None = Query(None),
    process_status: str | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user)
    rows = mi.list_intake(
        designation=designation,
        mailbox=mailbox,
        process_status=process_status,
        q=q,
        limit=limit,
        offset=offset,
    )
    for r in rows:
        mb = r.get("mailbox") or ""
        mid = r.get("message_id") or ""
        if mb and mid:
            r["gmail_url"] = mi.gmail_open_url(mb, mid)
    return {
        "items": rows,
        "unset_count": mi.count_unset(),
        "limit": limit,
        "offset": offset,
    }


@router.get("/jobs/{job_id}")
def get_job(
    job_id: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user)
    job = mi.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("/designate")
def designate(
    body: DesignateBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user)
    designation = (body.designation or "").strip().lower()
    if designation not in mi.DESIGNATIONS:
        raise HTTPException(
            status_code=400,
            detail=f"designation must be one of {sorted(mi.DESIGNATIONS)}",
        )
    try:
        results = mi.designate_many(
            uuids=body.uuids,
            designation=designation,
            actor=_actor(user),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return {"ok": True, "results": results, "unset_count": mi.count_unset()}


@router.post("/process")
def process(
    body: ProcessBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """Enqueue dry-run jobs for designated Revenue/FSR rows."""
    _assert_write(user)
    results = mi.enqueue_process(uuids=body.uuids, mode="dry_run", actor=_actor(user))
    return {"ok": True, "results": results}


@router.post("/apply")
def apply(
    body: ProcessBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """Enqueue apply jobs (requires prior dry_run_ok)."""
    _assert_write(user)
    results = mi.enqueue_process(uuids=body.uuids, mode="apply", actor=_actor(user))
    return {"ok": True, "results": results}


@router.get("/{intake_uuid}")
def get_mail(
    intake_uuid: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user)
    row = mi.get_by_uuid(intake_uuid)
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    row["gmail_url"] = mi.gmail_open_url(row.get("mailbox") or "", row.get("message_id") or "")
    row["jobs"] = mi.list_jobs_for_intake(intake_uuid)
    return row
