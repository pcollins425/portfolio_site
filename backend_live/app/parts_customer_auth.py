"""Parts storefront company-user auth (separate from DGS Google staff auth)."""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from typing import Any

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer = HTTPBearer(auto_error=False)

_PBKDF2_ITERS = 200_000


def _jwt_secret() -> str:
    secret = (os.environ.get("PARTS_CUSTOMER_JWT_SECRET") or "").strip()
    if not secret:
        secret = (os.environ.get("EMAINT_DEMO_JWT_SECRET") or "").strip()
    if not secret:
        raise HTTPException(status_code=503, detail="PARTS_CUSTOMER_JWT_SECRET not configured")
    return secret


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), _PBKDF2_ITERS
    ).hex()
    return f"pbkdf2_sha256${_PBKDF2_ITERS}${salt}${digest}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters_s, salt, digest = stored.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        iters = int(iters_s)
        check = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt), iters
        ).hex()
        return hmac.compare_digest(check, digest)
    except Exception:
        return False


def mint_user_token(
    *,
    user_id: str,
    company_id: str,
    email: str,
    role: str,
    hours: int = 24 * 14,
) -> str:
    now = int(time.time())
    payload = {
        "sub": user_id,
        "company_id": company_id,
        "email": email,
        "role": role,
        "typ": "parts_company_user",
        "iat": now,
        "exp": now + hours * 3600,
    }
    return jwt.encode(payload, _jwt_secret(), algorithm="HS256")


def decode_user_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired session") from exc
    if payload.get("typ") != "parts_company_user" or not payload.get("sub"):
        raise HTTPException(status_code=401, detail="Invalid session type")
    if not payload.get("company_id"):
        raise HTTPException(status_code=401, detail="Invalid session company")
    return payload


async def require_parts_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict[str, Any]:
    if not creds or not creds.credentials:
        raise HTTPException(status_code=401, detail="Sign in required")
    return decode_user_token(creds.credentials)


def optional_parts_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict[str, Any] | None:
    if not creds or not creds.credentials:
        return None
    try:
        return decode_user_token(creds.credentials)
    except HTTPException:
        return None


def require_company_admin(user: dict[str, Any] = Depends(require_parts_user)) -> dict[str, Any]:
    if (user.get("role") or "") != "admin":
        raise HTTPException(status_code=403, detail="Company admin required")
    return user


def require_staff_token(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> str:
    expected = (os.environ.get("PARTS_STAFF_TOKEN") or "").strip()
    if not expected:
        raise HTTPException(status_code=503, detail="PARTS_STAFF_TOKEN not configured")
    if not creds or not creds.credentials or not hmac.compare_digest(creds.credentials, expected):
        raise HTTPException(status_code=401, detail="Staff token required")
    return "staff"
