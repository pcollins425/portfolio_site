from __future__ import annotations

import json
import os
import re
from typing import Any

from app import settings as app_settings

_RE_ISO_DATE_ONLY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_WORK_DATE_FIELDS = frozenset(
    {"adddate", "editdate", "date_wo", "date_cmpl", "sch_date", "pts_rdy"}
)


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
    *,
    timeout: int = 60,
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
        with urlopen(req, timeout=timeout) as r:
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


def record_update(*, table: str, row_id: str, payload: dict, token: str | None = None) -> dict:
    server = _server()
    if not server:
        raise RuntimeError("Missing EMAINT_SERVER_URL")
    bearer = token or get_login_token()
    body = {"table": table, "id": row_id, "payload": payload}
    status, resp = _request("POST", f"{server}/api/v2/Record", data=body, token=bearer)
    try:
        out = json.loads(resp)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"eMaint Record invalid JSON: HTTP {status} {resp[:500]}") from exc
    if status != 200 or not out.get("valid"):
        msg = out.get("message") or resp[:500]
        raise RuntimeError(f"eMaint Record failed: HTTP {status} {msg}")
    return out


def get_admin_login_token() -> str | None:
    """Optional admin login for INVLOC creates (cuid required).

    Accepts ``EMAINT_ADMIN`` / ``EMAINT_ADMIN_PASS`` (master credentials) or
    ``EMAINT_ADMIN_USER`` / ``EMAINT_ADMIN_PASSWORD``.
    """
    _load_env()
    user = (
        os.environ.get("EMAINT_ADMIN")
        or os.environ.get("EMAINT_ADMIN_USER")
        or ""
    ).strip()
    password = (
        os.environ.get("EMAINT_ADMIN_PASS")
        or os.environ.get("EMAINT_ADMIN_PASSWORD")
        or ""
    ).strip()
    if not user or not password:
        return None
    agent = (
        os.environ.get("EMAINT_ADMIN_AGENT")
        or os.environ.get("EMAINT_ADMIN_USER_AGENT")
        or os.environ.get("EMAINT_USER_AGENT")
        or "PAUL_v1"
    ).strip()
    status, body = _request(
        "POST",
        _login_url(),
        data={},
        extra_headers={"username": user, "password": password, "XT-UserAgent": agent},
    )
    if status != 200:
        raise RuntimeError(f"eMaint admin login failed: HTTP {status} {body[:500]}")
    out = json.loads(body)
    token = out.get("token") or out.get("Token") or out.get("accessToken")
    if not token:
        raise RuntimeError("eMaint admin login response missing token")
    return str(token)


def find_invloc(*, item: str, invloc: str, token: str | None = None) -> dict[str, Any] | None:
    """Return INVLOC row ``{cuid, onhand, invloc, item}`` or None."""
    item = (item or "").strip()
    loc = (invloc or "").strip()
    if not item or not loc:
        return None
    rows = get_any_data(
        table="INVLOC",
        columns="cuid,item,invloc,onhand",
        filters=[
            {"field": "item", "operator": "eq", "value": item},
            {"field": "invloc", "operator": "eq", "value": loc},
        ],
        page_size=5,
        token=token,
    )
    if not rows:
        return None
    row = rows[0] or {}
    return {
        "cuid": str(row.get("cuid") or "").strip(),
        "item": str(row.get("item") or "").strip(),
        "invloc": str(row.get("invloc") or "").strip(),
        "onhand": row.get("onhand"),
    }


def set_invloc_onhand(*, cuid: str, onhand: float, token: str | None = None) -> dict:
    return record_update(
        table="INVLOC",
        row_id=cuid,
        payload={"onhand": float(onhand)},
        token=token,
    )


def create_invloc(*, item: str, invloc: str, onhand: float) -> str:
    """Create INVLOC via admin PUT. Returns cuid. Raises if admin creds missing."""
    import time

    admin = get_admin_login_token()
    if not admin:
        raise RuntimeError(
            f"No eMaint INVLOC for {item}/{invloc} and EMAINT_ADMIN / "
            "EMAINT_ADMIN_PASS not configured to create one"
        )
    server = _server()
    if not server:
        raise RuntimeError("Missing EMAINT_SERVER_URL")
    agent = (
        os.environ.get("EMAINT_ADMIN_AGENT")
        or os.environ.get("EMAINT_ADMIN_USER_AGENT")
        or os.environ.get("EMAINT_USER_AGENT")
        or "PAUL_v1"
    ).strip()
    probe = f"_TMP{int(time.time() * 1000) % 10_000_000:07d}"
    body = {
        "table": "INVLOC",
        "payload": {
            "cuid": probe,
            "item": item,
            "invloc": invloc,
            "onhand": float(onhand),
        },
    }
    status, resp = _request(
        "PUT",
        f"{server}/api/v2/Record",
        data=body,
        token=admin,
        extra_headers={"XT-UserAgent": agent},
        timeout=120,
    )
    try:
        out = json.loads(resp)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"eMaint INVLOC create invalid JSON: HTTP {status} {resp[:500]}") from exc
    if status == 200 and out.get("valid"):
        return str(out.get("id") or "").strip() or probe
    if "already exists" in (resp or "").lower():
        found = find_invloc(item=item, invloc=invloc)
        if found and found.get("cuid"):
            set_invloc_onhand(cuid=found["cuid"], onhand=onhand)
            return found["cuid"]
    raise RuntimeError(f"eMaint INVLOC create failed: HTTP {status} {resp[:400]}")


def set_arinvt01_onhand(*, item: str, onhand: float, token: str | None = None) -> dict:
    return record_update(
        table="ARINVT01",
        row_id=item,
        payload={"onhand": float(max(0.0, onhand))},
        token=token,
    )


def _strip_nulls(payload: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in payload.items() if v is not None}


def _normalize_work_dates(payload: dict[str, Any]) -> dict[str, Any]:
    out = dict(payload)
    for field in _WORK_DATE_FIELDS:
        if field not in out:
            continue
        value = out[field]
        if isinstance(value, str) and _RE_ISO_DATE_ONLY.match(value.strip()):
            out[field] = f"{value.strip()}T00:00:00"
    return out


def record_response_accepted(http_code: int, body_text: str) -> bool:
    if http_code != 200:
        return False
    try:
        return json.loads(body_text).get("valid") is True
    except json.JSONDecodeError:
        return False


def snippet_suggests_wo_conflict(snippet: str) -> bool:
    s = (snippet or "").lower()
    return any(
        n in s
        for n in ("duplicate", "already exists", "unique", "in use", "key violation")
    )


def get_any_data(
    *,
    table: str,
    columns: str,
    filters: list[dict[str, Any]] | None = None,
    sort_by: list[dict[str, str]] | None = None,
    page_size: int = 50,
    token: str | None = None,
) -> list[dict[str, Any]]:
    server = _server()
    if not server:
        raise RuntimeError("Missing EMAINT_SERVER_URL")
    bearer = token or get_login_token()
    body: dict[str, Any] = {
        "table": table,
        "pageNumber": 1,
        "pageSize": max(1, min(int(page_size), 200)),
        "columns": columns,
    }
    if filters:
        body["filter"] = {"logic": "and", "filters": filters}
    if sort_by:
        body["sortBy"] = sort_by
    status, resp = _request(
        "POST",
        f"{server}/api/v2/GetAnyData",
        data=body,
        token=bearer,
        timeout=120,
    )
    if status != 200:
        raise RuntimeError(f"eMaint GetAnyData failed: HTTP {status} {resp[:500]}")
    try:
        out = json.loads(resp)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"eMaint GetAnyData invalid JSON: {resp[:500]}") from exc
    rows = out.get("data") or []
    return rows if isinstance(rows, list) else []


def work_exists(wo: int | str, *, token: str | None = None) -> bool:
    key = str(wo).strip()
    if not key:
        return False
    rows = get_any_data(
        table="WORK",
        columns="wo",
        filters=[{"field": "wo", "operator": "eq", "value": int(key) if key.isdigit() else key}],
        page_size=1,
        token=token,
    )
    return bool(rows)


def max_work_wo(*, token: str | None = None) -> int:
    """Highest numeric WORK.wo on eMaint (hard source for allocation)."""
    rows = get_any_data(
        table="WORK",
        columns="wo",
        sort_by=[{"field": "wo", "dir": "desc"}],
        page_size=50,
        token=token,
    )
    best = 0
    for row in rows:
        raw = str((row or {}).get("wo") or "").strip()
        if raw.isdigit():
            best = max(best, int(raw))
    return best


def allocate_next_work_wo(*, token: str | None = None, max_scan: int = 40) -> int:
    """Next free WO No. from eMaint max + 1 (confirm free; skip gaps from deleted WOs)."""
    bearer = token or get_login_token()
    candidate = max_work_wo(token=bearer) + 1
    if candidate < 1:
        candidate = 1
    for _ in range(max(1, max_scan)):
        if not work_exists(candidate, token=bearer):
            return candidate
        candidate += 1
    raise RuntimeError(f"Could not find a free eMaint WO near {candidate}")


def create_work_record(wo: int | str, payload: dict[str, Any]) -> tuple[int, str]:
    """Create WORK via PUT ``{table, payload}`` with ``wo`` inside payload (int preferred).

    Falls back to POST without top-level ``id`` when PUT returns table-record-not-found.
    Returns ``(http_status, response_snippet)``.
    """
    server = _server()
    if not server:
        raise RuntimeError("Missing EMAINT_SERVER_URL")
    wo_key = str(wo).strip()
    if not wo_key or not wo_key.isdigit():
        raise ValueError("wo must be a numeric work order number")
    wo_int = int(wo_key)

    base = _normalize_work_dates(_strip_nulls(dict(payload)))
    base.pop("wo", None)
    token = get_login_token()
    url = f"{server}/api/v2/Record"

    def _send(method: str, body: dict[str, Any]) -> tuple[int, str]:
        return _request(method, url, data=body, token=token, timeout=120)

    trials: list[tuple[str, dict[str, Any]]] = [
        ("PUT", {"table": "WORK", "payload": {**base, "wo": wo_int}}),
        ("PUT", {"table": "WORK", "payload": {**base, "wo": wo_key}}),
    ]
    last_status = -1
    last_snippet = ""
    for method, body in trials:
        last_status, last_snippet = _send(method, body)
        if record_response_accepted(last_status, last_snippet):
            return last_status, last_snippet

    if "table record not found" in (last_snippet or "").lower():
        for wo_val in (wo_int, wo_key):
            last_status, last_snippet = _send(
                "POST", {"table": "WORK", "payload": {**base, "wo": wo_val}}
            )
            if record_response_accepted(last_status, last_snippet):
                return last_status, last_snippet

    return last_status, (last_snippet or "")[:1800]
