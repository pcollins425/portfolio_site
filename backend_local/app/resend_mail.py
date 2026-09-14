"""Resend outbound mail for the DGS App (stdlib urllib)."""

from __future__ import annotations

import base64
import json
import os
import urllib.error
import urllib.request
from typing import Any

RESEND_URL = "https://api.resend.com/emails"
DEFAULT_REPORTING_FROM = "DGS Reporting <reporting@collinsmediallc.com>"


def _env(key: str, default: str = "") -> str:
    return (os.environ.get(key) or default).strip()


def reporting_from() -> str:
    return _env("DGS_REPORTING_FROM") or _env("RESEND_FROM") or DEFAULT_REPORTING_FROM


def api_key_configured() -> bool:
    return bool(_env("RESEND_API_KEY"))


def send_email(
    *,
    to: str | list[str],
    subject: str,
    html: str,
    text: str,
    reply_to: str | None = None,
    cc: str | list[str] | None = None,
    attachments: list[dict[str, Any]] | None = None,
    idempotency_key: str | None = None,
) -> str:
    api_key = _env("RESEND_API_KEY")
    if not api_key:
        raise RuntimeError("RESEND_API_KEY is not configured")

    to_list = [to] if isinstance(to, str) else [addr for addr in (to or []) if addr]
    if not to_list:
        raise ValueError("at least one recipient is required")

    payload: dict[str, Any] = {
        "from": reporting_from(),
        "to": to_list,
        "subject": subject,
        "html": html,
        "text": text,
    }
    if reply_to:
        payload["reply_to"] = reply_to
    cc_list = [cc] if isinstance(cc, str) else [addr for addr in (cc or []) if addr]
    if cc_list:
        payload["cc"] = cc_list
    if attachments:
        payload["attachments"] = attachments

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "User-Agent": "dgs-portfolio-api/1.0",
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key[:256]

    request = urllib.request.Request(
        RESEND_URL,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers=headers,
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            result = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:1000]
        raise RuntimeError(f"Resend HTTP {exc.code}: {body}") from exc
    resend_id = str(result.get("id") or "").strip()
    if not resend_id:
        raise RuntimeError("Resend returned no email id")
    return resend_id


def attachment_bytes(*, filename: str, content: bytes) -> dict[str, str]:
    return {
        "filename": filename,
        "content": base64.b64encode(content).decode("ascii"),
    }
