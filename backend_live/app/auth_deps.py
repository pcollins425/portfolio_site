"""FastAPI dependencies for eMaint demo auth."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app import auth_service
from app import emaint_demo_permissions as perms
from app import permission_catalog as cat
from app import view_as

_bearer = HTTPBearer(auto_error=False)


def _optional_user(
    credentials: HTTPAuthorizationCredentials | None,
) -> dict[str, Any] | None:
    if not auth_service.auth_required():
        return None
    if not credentials or credentials.scheme.lower() != "bearer":
        return None
    token = (credentials.credentials or "").strip()
    if not token:
        return None
    try:
        claims = auth_service.decode_jwt(token)
        return auth_service.user_from_claims(claims)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def require_demo_user(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> dict[str, Any] | None:
    if not auth_service.auth_required():
        return None
    user = _optional_user(credentials)
    if not user:
        raise HTTPException(status_code=401, detail="Sign in required")
    target = request.headers.get(view_as.HEADER)
    return view_as.apply(user, target)


def require_area_read(area: str):
    """Close a route unless the effective permission map grants ``area``.

    Auth off (user is None) stays open. The Technician role is not consulted.
    """

    def _dependency(
        user: Annotated[dict[str, Any] | None, Depends(require_demo_user)],
    ) -> dict[str, Any] | None:
        if user is None:
            return None
        if not cat.has_area_read(user.get("permissions") or {}, area):
            raise HTTPException(status_code=403, detail="Not available for this account")
        return user

    return _dependency


def require_table_read(
    table_id: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)],
) -> dict[str, Any] | None:
    if user is None:
        return None
    permission_map = user.get("permissions") or {}
    if not perms.can_read_table(permission_map, table_id):
        raise HTTPException(status_code=403, detail=f"No read access to {table_id}")
    return user


def require_table_write(
    table_id: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)],
) -> dict[str, Any] | None:
    if user is None:
        return None
    permission_map = user.get("permissions") or {}
    if not perms.can_write_table(permission_map, table_id):
        raise HTTPException(status_code=403, detail=f"No write access to {table_id}")
    return user
