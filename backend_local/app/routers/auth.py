"""Google OAuth + session JWT for eMaint demo."""

from __future__ import annotations

from typing import Annotated, Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app import auth_service
from app.auth_deps import _optional_user

router = APIRouter(prefix="/api/auth", tags=["auth"])
_bearer = HTTPBearer(auto_error=False)


@router.get("/config")
def auth_config():
    return {
        "required": auth_service.auth_required(),
        "domain": auth_service.allowed_email_domain(),
        "login_path": "/api/auth/google/start",
    }


@router.get("/google/start")
def google_start(return_to: str | None = Query(None, max_length=500)):
    if not auth_service.auth_required():
        raise HTTPException(status_code=400, detail="Demo auth is disabled on this server")
    try:
        url = auth_service.google_login_url(return_to)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return RedirectResponse(url=url, status_code=302)


@router.get("/google/callback")
async def google_callback(
    code: str | None = Query(None),
    state: str | None = Query(None),
    error: str | None = Query(None),
):
    if error:
        return RedirectResponse(
            url=f"{auth_service.frontend_origin()}/emaintdemov1/login.html?error={quote(error)}",
            status_code=302,
        )
    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state")
    try:
        user, return_to = await auth_service.exchange_code_for_user(code, state)
        token = auth_service.issue_jwt(user)
    except ValueError as exc:
        return RedirectResponse(
            url=f"{auth_service.frontend_origin()}/emaintdemov1/login.html?error={quote(str(exc))}",
            status_code=302,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    sep = "&" if "?" in return_to else "?"
    dest = f"{return_to}{sep}auth_token={quote(token)}"
    return RedirectResponse(url=dest, status_code=302)


@router.get("/me")
def auth_me(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> dict[str, Any]:
    if not auth_service.auth_required():
        return {"auth_required": False, "user": None}
    user = _optional_user(credentials)
    if not user:
        raise HTTPException(status_code=401, detail="Sign in required")
    return {"auth_required": True, "user": user}
