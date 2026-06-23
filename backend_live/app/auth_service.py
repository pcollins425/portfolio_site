"""Google Workspace sign-in + JWT (employees.employee_roles)."""

from __future__ import annotations

import os
import secrets
import time
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
import jwt
from jwt import InvalidTokenError

from app import emaint_demo_permissions as perms
from app import mssql

_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
_JWT_ALG = "HS256"
_JWT_TTL_SECONDS = 60 * 60 * 12  # 12h demo session


def auth_required() -> bool:
    return (os.environ.get("EMAINT_DEMO_AUTH_REQUIRED") or "true").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def allowed_email_domain() -> str:
    return (os.environ.get("EMAINT_DEMO_ALLOWED_EMAIL_DOMAIN") or "dynamicgamingsolutions.com").strip().lower()


def jwt_secret() -> str:
    secret = (os.environ.get("EMAINT_DEMO_JWT_SECRET") or "").strip()
    if not secret:
        raise RuntimeError("EMAINT_DEMO_JWT_SECRET is not configured")
    return secret


def google_client_id() -> str:
    value = (os.environ.get("GOOGLE_OAUTH_CLIENT_ID") or "").strip()
    if not value:
        raise RuntimeError("GOOGLE_OAUTH_CLIENT_ID is not configured")
    return value


def google_client_secret() -> str:
    value = (os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET") or "").strip()
    if not value:
        raise RuntimeError("GOOGLE_OAUTH_CLIENT_SECRET is not configured")
    return value


def oauth_redirect_uri() -> str:
    local = (os.environ.get("EMAINT_DEMO_OAUTH_REDIRECT_URI_LOCAL") or "").strip()
    if local:
        return local
    value = (os.environ.get("EMAINT_DEMO_OAUTH_REDIRECT_URI") or "").strip()
    if not value:
        raise RuntimeError("EMAINT_DEMO_OAUTH_REDIRECT_URI is not configured")
    return value


def _local_oauth_enabled() -> bool:
    return bool((os.environ.get("EMAINT_DEMO_OAUTH_REDIRECT_URI_LOCAL") or "").strip())


def frontend_app_path() -> str:
    explicit = (os.environ.get("EMAINT_DEMO_FRONTEND_APP_PATH") or "").strip()
    if explicit:
        return explicit if explicit.startswith("/") else f"/{explicit}"
    if _local_oauth_enabled():
        return "/"
    return "/dgsappv1"


def frontend_origins() -> list[str]:
    origins: list[str] = []
    local = (os.environ.get("EMAINT_DEMO_FRONTEND_ORIGIN_LOCAL") or "").strip()
    if local:
        origins.append(local.rstrip("/"))
    raw = (os.environ.get("EMAINT_DEMO_FRONTEND_ORIGIN") or "").strip()
    if raw:
        origins.extend(part.strip().rstrip("/") for part in raw.split(",") if part.strip())
    if not origins:
        if _local_oauth_enabled():
            origins.append("http://localhost:8080")
        else:
            origins.append("https://www.collinsmediallc.com")
    seen: set[str] = set()
    out: list[str] = []
    for origin in origins:
        if origin not in seen:
            seen.add(origin)
            out.append(origin)
    return out


def frontend_origin() -> str:
    return frontend_origins()[0]


def frontend_page(path: str) -> str:
    path = path.lstrip("/")
    base = frontend_app_path().rstrip("/")
    origin = frontend_origin()
    if base:
        return f"{origin}/{base}/{path}"
    return f"{origin}/{path}"


def _return_to_allowed(parsed) -> bool:
    if parsed.scheme not in ("http", "https"):
        return False
    for allowed in frontend_origins():
        origin = urlparse(allowed)
        if parsed.scheme == origin.scheme and parsed.netloc == origin.netloc:
            return True
    if _local_oauth_enabled() and parsed.hostname in ("localhost", "127.0.0.1"):
        return True
    return False


def _catalog() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _employee_by_email(email: str) -> dict[str, Any] | None:
    rows = mssql.query(
        """
        SELECT TOP 1
            er.reference_key AS employee_id,
            er.name,
            er.email,
            er.active,
            er.override_permissions,
            r.role AS role_name,
            r.permissions AS role_permissions
        FROM employees.employee_roles er
        LEFT JOIN employees.roles r ON r.reference_key = er.role_id
        WHERE LOWER(LTRIM(RTRIM(er.email))) = LOWER(LTRIM(RTRIM(%s)))
          AND er.active = 1
        """,
        (email,),
        database=_catalog(),
        profile="dashboard",
        load_env=False,
    )
    return rows[0] if rows else None


def effective_permissions(employee: dict[str, Any]) -> dict[str, str]:
    return perms.merge_permissions(
        employee.get("role_permissions"),
        employee.get("override_permissions"),
    )


def build_user_payload(employee: dict[str, Any]) -> dict[str, Any]:
    permission_map = effective_permissions(employee)
    tables = perms.allowed_table_ids(permission_map)
    return {
        "employee_id": employee["employee_id"],
        "name": employee.get("name"),
        "email": employee.get("email"),
        "role": employee.get("role_name"),
        "permissions": permission_map,
        "tables": tables,
    }


def issue_jwt(user: dict[str, Any]) -> str:
    now = int(time.time())
    payload = {
        "sub": user["email"],
        "employee_id": user["employee_id"],
        "name": user.get("name"),
        "role": user.get("role"),
        "permissions": user.get("permissions") or {},
        "tables": user.get("tables") or [],
        "iat": now,
        "exp": now + _JWT_TTL_SECONDS,
    }
    return jwt.encode(payload, jwt_secret(), algorithm=_JWT_ALG)


def decode_jwt(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, jwt_secret(), algorithms=[_JWT_ALG])
    except InvalidTokenError as exc:
        raise ValueError("invalid or expired token") from exc


def user_from_claims(claims: dict[str, Any]) -> dict[str, Any]:
    permission_map = claims.get("permissions") or {}
    if not isinstance(permission_map, dict):
        permission_map = perms.parse_permissions_blob(str(permission_map))
    tables = claims.get("tables")
    if not tables:
        tables = perms.allowed_table_ids(permission_map)
    return {
        "employee_id": claims.get("employee_id"),
        "name": claims.get("name"),
        "email": claims.get("sub"),
        "role": claims.get("role"),
        "permissions": permission_map,
        "tables": tables,
    }


def _safe_return_path(return_to: str | None) -> str:
    default = frontend_page("dashboard.html")
    if not return_to:
        return default
    parsed = urlparse(return_to)
    if not _return_to_allowed(parsed):
        return default
    return return_to


def issue_oauth_state(return_to: str | None) -> str:
    now = int(time.time())
    payload = {
        "typ": "oauth",
        "return_to": _safe_return_path(return_to),
        "nonce": secrets.token_urlsafe(16),
        "iat": now,
        "exp": now + 600,
    }
    return jwt.encode(payload, jwt_secret(), algorithm=_JWT_ALG)


def decode_oauth_state(token: str) -> str:
    try:
        claims = jwt.decode(token, jwt_secret(), algorithms=[_JWT_ALG])
    except InvalidTokenError as exc:
        raise ValueError("invalid OAuth state") from exc
    if claims.get("typ") != "oauth":
        raise ValueError("invalid OAuth state")
    return _safe_return_path(claims.get("return_to"))


def google_login_url(return_to: str | None) -> str:
    state_token = issue_oauth_state(return_to)
    params = {
        "client_id": google_client_id(),
        "redirect_uri": oauth_redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "online",
        "include_granted_scopes": "true",
        "hd": allowed_email_domain(),
        "state": state_token,
        "prompt": "select_account",
    }
    return f"{_GOOGLE_AUTH_URL}?{urlencode(params)}"


def _verify_email_domain(email: str) -> None:
    domain = allowed_email_domain()
    if not email or "@" not in email:
        raise ValueError("Google account has no email")
    if email.split("@", 1)[1].lower() != domain:
        raise ValueError(f"Sign-in must use @{domain}")


async def exchange_code_for_user(code: str, state_token: str) -> tuple[dict[str, Any], str]:
    return_to = decode_oauth_state(state_token)

    async with httpx.AsyncClient(timeout=30.0) as client:
        token_res = await client.post(
            _GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": google_client_id(),
                "client_secret": google_client_secret(),
                "redirect_uri": oauth_redirect_uri(),
                "grant_type": "authorization_code",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if token_res.status_code >= 400:
            raise ValueError("Google token exchange failed")
        token_json = token_res.json()
        access_token = token_json.get("access_token")
        if not access_token:
            raise ValueError("Google did not return an access token")

        user_res = await client.get(
            _GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if user_res.status_code >= 400:
            raise ValueError("Google userinfo failed")
        profile = user_res.json()

    email = (profile.get("email") or "").strip().lower()
    if not profile.get("verified_email", True):
        raise ValueError("Google email is not verified")
    _verify_email_domain(email)

    employee = _employee_by_email(email)
    if not employee:
        raise ValueError("No active employee record for this email")

    user = build_user_payload(employee)
    return user, return_to
