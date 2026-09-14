"""Employee directory for in-app send-to-coworker flows."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app import employee_directory
from app.auth_deps import require_demo_user

router = APIRouter(prefix="/api/employees", tags=["employees"])


@router.get("/directory")
def search_directory(
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)],
    q: str = Query("", max_length=80),
):
    """Active employees with an email — signed-in staff only, no freeform addresses."""
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in required")
    try:
        people = employee_directory.list_directory(q)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    return {"employees": people}
