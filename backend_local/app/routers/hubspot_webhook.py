"""HubSpot CRM webhooks → clients.hubspot_webhook_queue (enqueue only).

Commerce landing stays SQL SSOT for the app. A separate worker should refetch
the object and MERGE into hubspot_* tables; nightly sync_hubspot_crm.py reconciles.

Auth: HubSpot Signature v3 (preferred) or v1, using HUBSPOT_CLIENT_SECRET.
Optional local-only: HUBSPOT_WEBHOOK_ALLOW_UNSIGNED=1.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from app import mssql

router = APIRouter(prefix="/api/hubspot", tags=["hubspot"])
_log = logging.getLogger("app.hubspot_webhook")

_MAX_SKEW_SEC = 5 * 60


def _db() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _client_secret() -> str:
    return (
        os.environ.get("DGS_COMMERCE_CLIENT_SECRET")
        or os.environ.get("HUBSPOT_CLIENT_SECRET")
        or ""
    ).strip()


def _client_id() -> str:
    return (
        os.environ.get("DGS_COMMERCE_CLIENT_ID")
        or os.environ.get("HUBSPOT_CLIENT_ID")
        or ""
    ).strip()


def _access_token() -> str:
    """Private-app static token for CRM API (worker / sync). Not used at enqueue time."""
    return (
        os.environ.get("DGS_COMMERCE_ACCESS_TOKEN")
        or os.environ.get("HUBSPOT_ACCESS_TOKEN")
        or ""
    ).strip()


def _allow_unsigned() -> bool:
    return (os.environ.get("HUBSPOT_WEBHOOK_ALLOW_UNSIGNED") or "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def _verify_v1(secret: str, body: bytes, signature: str) -> bool:
    expected = hashlib.sha256(secret.encode("utf-8") + body).hexdigest()
    return hmac.compare_digest(expected, (signature or "").strip())


def _verify_v3(
    secret: str,
    *,
    method: str,
    uri: str,
    body: bytes,
    timestamp: str,
    signature: str,
) -> bool:
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False
    if abs(int(time.time()) * 1000 - ts) > _MAX_SKEW_SEC * 1000:
        return False
    raw = f"{method}{uri}{body.decode('utf-8')}{timestamp}"
    digest = hmac.new(secret.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).digest()
    expected = base64.b64encode(digest).decode("ascii")
    return hmac.compare_digest(expected, (signature or "").strip())


def _object_type_from_subscription(sub: str | None) -> str | None:
    if not sub:
        return None
    s = sub.strip().lower()
    # deal.propertyChange / object.creation with objectType elsewhere
    for prefix in (
        "deal",
        "company",
        "contact",
        "line_item",
        "note",
        "product",
        "quote",
    ):
        if s.startswith(prefix + ".") or s == prefix:
            return prefix
    if s.startswith("object."):
        return None
    return None


def _as_bigint(v: Any) -> int | None:
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _occurred_at(v: Any) -> datetime | None:
    if v is None or v == "":
        return None
    try:
        ms = int(v)
        return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).replace(tzinfo=None)
    except (TypeError, ValueError):
        return None


def _enqueue_event(ev: dict[str, Any]) -> bool:
    """Insert one event. Returns True if a new queue row was written."""
    sub = ev.get("subscriptionType") or ev.get("subscription_type")
    obj_type = ev.get("objectType") or ev.get("object_type") or _object_type_from_subscription(
        str(sub) if sub else None
    )
    object_id = _as_bigint(ev.get("objectId") if "objectId" in ev else ev.get("object_id"))
    event_id = ev.get("eventId") or ev.get("event_id")
    event_id_s = str(event_id) if event_id is not None else None
    prop = ev.get("propertyName") or ev.get("property_name")
    portal = _as_bigint(ev.get("portalId") if "portalId" in ev else ev.get("portal_id"))
    occurred = _occurred_at(ev.get("occurredAt") if "occurredAt" in ev else ev.get("occurred_at"))
    payload = json.dumps(ev, separators=(",", ":"), default=str)

    # Idempotent on HubSpot eventId when present
    if event_id_s:
        existing = mssql.query(
            """
            SELECT TOP 1 queue_id
            FROM clients.hubspot_webhook_queue
            WHERE event_id = %s
            """,
            (event_id_s,),
            database=_db(),
            profile="field",
            load_env=False,
        )
        if existing:
            return False

    mssql.execute(
        """
        INSERT INTO clients.hubspot_webhook_queue (
            subscription_type, object_type, object_id, property_name,
            portal_id, event_id, occurred_at, payload, status
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, N'pending')
        """,
        (
            str(sub)[:80] if sub else None,
            str(obj_type)[:40] if obj_type else None,
            object_id,
            str(prop)[:100] if prop else None,
            portal,
            event_id_s[:80] if event_id_s else None,
            occurred,
            payload,
        ),
        database=_db(),
        profile="field",
        load_env=False,
    )
    return True


@router.get("/webhook/health")
def hubspot_webhook_health():
    return {
        "ok": True,
        "queue": "clients.hubspot_webhook_queue",
        "client_id_configured": bool(_client_id()),
        "client_secret_configured": bool(_client_secret()),
        "access_token_configured": bool(_access_token()),
    }


@router.post("/webhook")
async def hubspot_webhook(
    request: Request,
    x_hubspot_signature: str | None = Header(default=None, alias="X-HubSpot-Signature"),
    x_hubspot_signature_v3: str | None = Header(default=None, alias="X-HubSpot-Signature-v3"),
    x_hubspot_request_timestamp: str | None = Header(
        default=None, alias="X-HubSpot-Request-Timestamp"
    ),
):
    body = await request.body()
    secret = _client_secret()

    if secret:
        uri = str(request.url).split("?")[0]
        # Prefer v3
        ok = False
        if x_hubspot_signature_v3 and x_hubspot_request_timestamp:
            ok = _verify_v3(
                secret,
                method=request.method.upper(),
                uri=uri,
                body=body,
                timestamp=x_hubspot_request_timestamp,
                signature=x_hubspot_signature_v3,
            )
        elif x_hubspot_signature:
            ok = _verify_v1(secret, body, x_hubspot_signature)
        if not ok:
            raise HTTPException(status_code=401, detail="Invalid HubSpot signature")
    elif not _allow_unsigned():
        raise HTTPException(
            status_code=503,
            detail="DGS_COMMERCE_CLIENT_SECRET (or HUBSPOT_CLIENT_SECRET) not configured",
        )

    try:
        data = json.loads(body.decode("utf-8") or "[]")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"invalid JSON: {exc}") from exc

    events: list[dict[str, Any]]
    if isinstance(data, list):
        events = [e for e in data if isinstance(e, dict)]
    elif isinstance(data, dict):
        events = [data]
    else:
        raise HTTPException(status_code=400, detail="JSON must be an object or array")

    enqueued = 0
    for ev in events:
        try:
            if _enqueue_event(ev):
                enqueued += 1
        except Exception as exc:
            _log.exception("hubspot webhook enqueue failed: %s", exc)
            # Still 200 so HubSpot does not storm retries for one bad row;
            # leave sibling events processed.
            continue

    return JSONResponse({"ok": True, "enqueued": enqueued, "received": len(events)})
