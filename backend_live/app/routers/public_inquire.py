"""Public Collins Media inquire form — no auth; Resend to personal inbox."""

from __future__ import annotations

import html
import re
import threading
import time
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app import resend_mail

router = APIRouter(prefix="/api/public", tags=["public"])

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_RATE_LOCK = threading.Lock()
_RATE: dict[str, list[float]] = {}
_RATE_WINDOW_SEC = 600
_RATE_MAX = 5


class InquireBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    company: str = Field(default="", max_length=160)
    message: str = Field(min_length=1, max_length=4000)
    mix: list[str] = Field(default_factory=list, max_length=40)
    # Honeypot — bots fill this; humans leave blank.
    website: str = Field(default="", max_length=200)


def _client_ip(request: Request) -> str:
    forwarded = (request.headers.get("cf-connecting-ip") or "").strip()
    if forwarded:
        return forwarded[:80]
    xff = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if xff:
        return xff[:80]
    if request.client and request.client.host:
        return request.client.host[:80]
    return "unknown"


def _rate_ok(ip: str) -> bool:
    now = time.time()
    with _RATE_LOCK:
        hits = [t for t in _RATE.get(ip, []) if now - t < _RATE_WINDOW_SEC]
        if len(hits) >= _RATE_MAX:
            _RATE[ip] = hits
            return False
        hits.append(now)
        _RATE[ip] = hits
        return True


def _clean_lines(items: list[str]) -> list[str]:
    out: list[str] = []
    for raw in items[:40]:
        s = " ".join(str(raw or "").split())[:120]
        if s:
            out.append(s)
    return out


@router.post("/inquire")
def submit_inquire(body: InquireBody, request: Request) -> dict[str, Any]:
    if (body.website or "").strip():
        # Silent success for bots.
        return {"ok": True}

    if not _rate_ok(_client_ip(request)):
        raise HTTPException(status_code=429, detail="Too many inquiries from this network. Try again later.")

    name = " ".join(body.name.split())
    email = body.email.strip()
    company = " ".join((body.company or "").split())
    message = body.message.strip()
    mix = _clean_lines(body.mix)

    if not name or not message:
        raise HTTPException(status_code=400, detail="Name and message are required.")
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if not resend_mail.api_key_configured():
        raise HTTPException(status_code=503, detail="Inquire mail is not configured on the server yet.")

    mix_text = "\n".join(f"- {item}" for item in mix) if mix else "- (none selected)"
    subject = (
        f"Collins Media inquiry — {len(mix)} item{'s' if len(mix) != 1 else ''}"
        if mix
        else "Collins Media inquiry"
    )
    text = "\n".join(
        [
            f"Name: {name}",
            f"Email: {email}",
            f"Company: {company or '—'}",
            "",
            "Mix:",
            mix_text,
            "",
            "Message:",
            message,
        ]
    )
    html_body = (
        f"<p><strong>Name:</strong> {html.escape(name)}<br>"
        f"<strong>Email:</strong> {html.escape(email)}<br>"
        f"<strong>Company:</strong> {html.escape(company or '—')}</p>"
        f"<p><strong>Mix</strong></p><ul>"
        + "".join(f"<li>{html.escape(item)}</li>" for item in (mix or ["(none selected)"]))
        + "</ul>"
        f"<p><strong>Message</strong></p>"
        f"<p>{html.escape(message).replace(chr(10), '<br>')}</p>"
    )

    try:
        resend_id = resend_mail.send_email(
            to=resend_mail.collins_inquire_to(),
            subject=subject,
            html=html_body,
            text=text,
            reply_to=email,
            from_addr=resend_mail.collins_inquire_from(),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not send inquiry: {exc}") from exc

    return {"ok": True, "id": resend_id}
