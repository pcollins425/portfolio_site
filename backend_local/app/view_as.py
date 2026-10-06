"""Dev view: one signed-in person previews another employee's permission map.

The signed-in email and employee id stay put, so anything recorded still
carries that person. Non-read requests are refused while a target is selected.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app import auth_service
from app import permission_catalog as cat

HEADER = "x-dgs-view-as"
AREA = "dgs_view_as"
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_PUBLIC_USER_KEYS = ("employee_id", "name", "email", "role", "permissions", "tables")


def reject_write(method: str, header_value: str | None) -> str | None:
    """Return an error detail when a dev-view request is trying to write."""
    if not (header_value or "").strip():
        return None
    if (method or "").upper() in _SAFE_METHODS:
        return None
    return "Dev view is read-only. Switch back to yourself to make changes."


def retain_private_overrides(existing_blob: str | None, new_blob: str | None) -> str:
    """Keep the dev-view grant on a row when the Employees screen rewrites overrides."""
    existing = cat.parse_permissions_blob(existing_blob)
    merged = cat.parse_permissions_blob(new_blob)
    level = existing.get(AREA)
    if level and AREA not in merged:
        merged[AREA] = level
    return cat.serialize_permissions(merged)


def _actor_permissions(user: dict[str, Any]) -> dict[str, str]:
    raw = user.get("actor_permissions")
    if isinstance(raw, dict) and raw:
        return raw
    perms = user.get("permissions") or {}
    return perms if isinstance(perms, dict) else {}


def apply(user: dict[str, Any], target_id: str | None) -> dict[str, Any]:
    """Overlay the target's grants. Identity fields stay the signed-in person."""
    actor_perms = _actor_permissions(user)
    can = cat.has_area_read(actor_perms, AREA)
    target = (target_id or "").strip()
    if not target:
        out = dict(user)
        out["actor_permissions"] = actor_perms
        out["can_view_as"] = can
        out["view_as"] = None
        return out
    if not can:
        raise HTTPException(status_code=403, detail="Dev view is not available on this sign-in")
    if len(target) > 25:
        raise HTTPException(status_code=404, detail="That person is not an active employee")
    employee = auth_service.employee_by_id(target)
    if not employee:
        raise HTTPException(status_code=404, detail="That person is not an active employee")
    target_user = auth_service.build_user_payload(employee)
    out = dict(user)
    out["actor_permissions"] = actor_perms
    out["can_view_as"] = True
    out["permissions"] = target_user.get("permissions") or {}
    out["tables"] = target_user.get("tables") or []
    out["view_as"] = {
        "employee_id": target_user.get("employee_id"),
        "name": target_user.get("name"),
        "email": target_user.get("email"),
        "role": target_user.get("role"),
    }
    return out


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {key: user.get(key) for key in _PUBLIC_USER_KEYS}
