"""Minimal AppSheet REST client (Tech Order Form / Parts).

Env (Slot Server ``backend_live/.env`` or master credentials):
  TECH_APP_ID, TECH_APP_KEY
Optional: APPSHEET_APP_ID / APPSHEET_ACCESS_KEY overrides.
"""

from __future__ import annotations

import os
from typing import Any

import requests

DEFAULT_BASE_URL = "https://api.appsheet.com/api/v2"
TECH_ORDER_TABLE = "Tech Order Form"
PARTS_TABLE = "Parts"


class AppSheetError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, body: str = ""):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


def _strip(value: str | None) -> str:
    if not value:
        return ""
    v = value.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
        return v[1:-1]
    return v


def tech_credentials() -> tuple[str, str]:
    app_id = _strip(
        os.environ.get("APPSHEET_APP_ID")
        or os.environ.get("TECH_APP_ID")
    )
    key = _strip(
        os.environ.get("APPSHEET_ACCESS_KEY")
        or os.environ.get("TECH_APP_KEY")
    )
    if not app_id or not key:
        raise AppSheetError(
            "TECH_APP_ID / TECH_APP_KEY not configured on the API host"
        )
    return app_id, key


def table_action(
    table_name: str,
    action: str,
    *,
    rows: list[dict[str, Any]] | None = None,
    properties: dict[str, Any] | None = None,
    timeout: float = 120.0,
) -> dict[str, Any]:
    app_id, key = tech_credentials()
    url = f"{DEFAULT_BASE_URL}/apps/{app_id}/tables/{table_name}/Action"
    payload: dict[str, Any] = {
        "Action": action,
        "Properties": dict(properties or {}),
    }
    if rows is not None:
        payload["Rows"] = rows
    resp = requests.post(
        url,
        json=payload,
        headers={
            "ApplicationAccessKey": key,
            "Content-Type": "application/json",
        },
        timeout=timeout,
    )
    text = resp.text or ""
    if not resp.ok:
        raise AppSheetError(
            f"AppSheet {action} on {table_name!r} failed ({resp.status_code})",
            status_code=resp.status_code,
            body=text[:2000],
        )
    if not text.strip():
        return {"Rows": []}
    try:
        parsed = resp.json()
    except ValueError as exc:
        raise AppSheetError(f"Invalid JSON from AppSheet: {text[:400]}") from exc
    if isinstance(parsed, list):
        return {"Rows": parsed}
    if isinstance(parsed, dict):
        return parsed
    return {"raw": text}


def find_rows(
    table_name: str,
    *,
    selector: str | None = None,
    top: int | None = None,
) -> list[dict[str, Any]]:
    props: dict[str, Any] = {"Locale": "en-US"}
    if top is not None:
        props["Selector"] = f"TOP(Filter({table_name}, TRUE), {int(top)})"
    elif selector:
        props["Selector"] = selector
    result = table_action(table_name, "Find", properties=props)
    rows = result.get("Rows")
    if rows is None:
        raise AppSheetError(f"Unexpected Find response for {table_name!r}")
    return rows


def add_rows(table_name: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result = table_action(table_name, "Add", rows=rows, properties={"Locale": "en-US"})
    out = result.get("Rows")
    return out if out is not None else []
