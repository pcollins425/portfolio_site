"""Dev-view staff picker. The signed-in person must hold dgs_view_as."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException

from app import employee_directory
from app.auth_deps import require_demo_user

router = APIRouter(prefix="/api/dev/view-as", tags=["dev-view"])


@router.get("/directory")
def view_as_directory(
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)],
):
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in required")
    if not user.get("can_view_as"):
        raise HTTPException(status_code=403, detail="Dev view is not available on this sign-in")
    try:
        people = employee_directory.list_view_as()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    actor_id = str(user.get("employee_id") or "").strip()
    return {
        "employees": [p for p in people if p.get("employee_id") != actor_id],
    }
