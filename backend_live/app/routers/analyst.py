"""Paul-only Analyst intake queue."""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app import analyst_queue as q
from app.auth_deps import require_demo_user

router = APIRouter(prefix="/api/analyst", tags=["analyst"])


class ResolveBody(BaseModel):
    id: str = Field(min_length=3)
    status: str
    note: str


@router.get("/summary")
def analyst_summary(
    through: str | None = Query(None, description="YYYY-MM latest month to include"),
    months: int = Query(12, ge=1, le=24),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    q.assert_paul(user)
    if not through or len(through.strip()) < 7:
        raise HTTPException(status_code=400, detail="through=YYYY-MM required")
    return q.queue_summary(through=through.strip()[:7], months=months)


@router.get("/queue")
def analyst_queue(
    month: str | None = Query(None, description="YYYY-MM focus month"),
    status: str = Query("open"),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    q.assert_paul(user)
    if not month or len(month.strip()) < 7:
        raise HTTPException(status_code=400, detail="month=YYYY-MM required")
    return q.queue_for_month(month.strip()[:7], status=status)


@router.post("/queue/resolve")
def analyst_resolve(
    body: ResolveBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    q.assert_paul(user)
    saved = q.resolve_flag(body.id, status=body.status, note=body.note, user=user)
    return {"ok": True, "id": body.id, **saved}
