from __future__ import annotations

import json
import os

from app import settings as app_settings


def _load_env() -> None:
    app_settings.load_local_env()


def _server() -> str:
    _load_env()
    return (os.environ.get("EMAINT_SERVER_URL") or "").rstrip("/")


def _login_url() -> str:
    _load_env()
    server = _server()
    return (os.environ.get("EMAINT_LOGIN_URL") or "").strip() or f"{server}/api/v2/Login"


def _request(
    method: str,
    url: str,
    data: dict | None = None,
    token: str | None = None,
    extra_headers: dict | None = None,
) -> tuple[int, str]:
    from urllib.error import HTTPError, URLError
    from urllib.request import Request, urlopen

    user_agent = (os.environ.get("EMAINT_USER_AGENT") or "PAUL_v1").strip()
    headers = {
        "XT-UserAgent": user_agent,
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    if extra_headers:
        headers.update(extra_headers)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    encoded = None if data is None else json.dumps(data).encode("utf-8")
    req = Request(url, data=encoded, headers=headers, method=method)
    try:
        with urlopen(req, timeout=60) as r:
            return r.status, r.read().decode("utf-8", errors="replace")
    except HTTPError as e:
        return e.code, (e.read().decode("utf-8", errors="replace") if e.fp else str(e))
    except URLError as e:
        return -1, str(e.reason)


def get_login_token() -> str:
    _load_env()
    user = (os.environ.get("EMAINT_USER") or "").strip()
    password = (os.environ.get("EMAINT_PASSWORD") or "").strip()
    if not user or not password:
        raise RuntimeError("Missing EMAINT_USER or EMAINT_PASSWORD")
    login_headers = {
        "username": user,
        "password": password,
    }
    status, body = _request("POST", _login_url(), data={}, extra_headers=login_headers)
    if status != 200:
        raise RuntimeError(f"eMaint login failed: HTTP {status} {body[:500]}")
    out = json.loads(body)
    token = out.get("token") or out.get("Token") or out.get("accessToken")
    if not token:
        raise RuntimeError("eMaint login response missing token")
    return str(token)


def record_update(*, table: str, row_id: str, payload: dict) -> dict:
    server = _server()
    if not server:
        raise RuntimeError("Missing EMAINT_SERVER_URL")
    token = get_login_token()
    body = {"table": table, "id": row_id, "payload": payload}
    status, resp = _request("POST", f"{server}/api/v2/Record", data=body, token=token)
    try:
        out = json.loads(resp)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"eMaint Record invalid JSON: HTTP {status} {resp[:500]}") from exc
    if status != 200 or not out.get("valid"):
        msg = out.get("message") or resp[:500]
        raise RuntimeError(f"eMaint Record failed: HTTP {status} {msg}")
    return out
