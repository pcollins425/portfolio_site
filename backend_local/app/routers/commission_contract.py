"""Paul-only commission contract review queue."""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app import commission_contract_queue as q
from app.auth_deps import require_demo_user

router = APIRouter(prefix="/api/commission-contract", tags=["commission-contract"])


class ResolveBody(BaseModel):
    id: str = Field(min_length=3)
    status: str
    note: str


@router.get("/ping")
def commission_ping():
    return {
        "ok": True,
        "queue": "/api/commission-contract/queue",
        "summary": "/api/commission-contract/summary",
    }


@router.get("/summary")
def commission_summary(
    through: str | None = Query(None, description="YYYY-MM latest month to include"),
    months: int | None = Query(None, ge=1, le=120, description="Omit to scan all façade months"),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    q.assert_paul(user)
    if not through or len(through.strip()) < 7:
        raise HTTPException(status_code=400, detail="through=YYYY-MM required")
    try:
        return q.queue_summary(through=through.strip()[:7], months=months)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"commission summary failed: {exc}") from exc


@router.get("/queue")
def commission_queue(
    month: str | None = Query(None, description="YYYY-MM focus month"),
    status: str = Query("open"),
    kind: str = Query("all", description="all|delta|missing|unknown|roots"),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    q.assert_paul(user)
    if not month or len(month.strip()) < 7:
        raise HTTPException(status_code=400, detail="month=YYYY-MM required")
    try:
        return q.queue_for_month(month.strip()[:7], status=status, kind=kind)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"commission queue scan failed: {exc}") from exc


@router.post("/queue/resolve")
def commission_resolve(
    body: ResolveBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    q.assert_paul(user)
    saved = q.resolve_flag(body.id, status=body.status, note=body.note, user=user)
    return {"ok": True, "id": body.id, **saved}
