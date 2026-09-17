"""Org rollout gates for Finance / Admin / Workspace (deny unless grant).

When auth is disabled (local), checks are skipped (user is None from deps).
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException

from app import permission_catalog as cat


def _perms(user: dict[str, Any] | None) -> dict[str, str]:
    if user is None:
        return {}
    raw = user.get("permissions") or {}
    return raw if isinstance(raw, dict) else cat.parse_permissions_blob(str(raw))


def _skip(user: dict[str, Any] | None) -> bool:
    """Auth off → FastAPI deps pass user=None; allow local/dev."""
    return user is None


def assert_expenses_read(user: dict[str, Any] | None) -> None:
    if _skip(user):
        return
    if not cat.has_area_read(_perms(user), cat.EXPENSES_AREA):
        raise HTTPException(status_code=403, detail="No expenses read access")


def assert_expenses_mass_edit_read(user: dict[str, Any] | None) -> None:
    if _skip(user):
        return
    if not cat.has_area_read(_perms(user), cat.EXPENSES_MASS_EDIT_AREA):
        raise HTTPException(status_code=403, detail="No expenses mass-edit read access")


def assert_expenses_mass_edit_write(user: dict[str, Any] | None) -> None:
    if _skip(user):
        return
    if not cat.has_area_write(_perms(user), cat.EXPENSES_MASS_EDIT_AREA):
        raise HTTPException(status_code=403, detail="No expenses mass-edit write access")


def assert_expenses_mass_edit(user: dict[str, Any] | None) -> None:
    """Back-compat alias for write (batch)."""
    assert_expenses_mass_edit_write(user)


def assert_finance_dashboard_read(user: dict[str, Any] | None) -> None:
    if _skip(user):
        return
    if not cat.has_area_read(_perms(user), cat.FINANCE_DASHBOARD_AREA):
        raise HTTPException(status_code=403, detail="No dgs_finance_dashboard read access")


def assert_assistant_read(user: dict[str, Any] | None) -> None:
    if _skip(user):
        return
    if not cat.has_area_read(_perms(user), cat.ASSISTANT_AREA):
        raise HTTPException(status_code=403, detail="No dgs_assistant read access")


def assert_assistant_secrets_read(user: dict[str, Any] | None) -> None:
    if _skip(user):
        return
    if not cat.has_area_read(_perms(user), cat.ASSISTANT_SECRETS_AREA):
        raise HTTPException(status_code=403, detail="No dgs_assistant_secrets read access")


def assert_assistant_secrets_write(user: dict[str, Any] | None) -> None:
    if _skip(user):
        return
    if not cat.has_area_write(_perms(user), cat.ASSISTANT_SECRETS_AREA):
        raise HTTPException(status_code=403, detail="No dgs_assistant_secrets write access")
