"""In-memory page-chat sessions (page/visit locked — not sticky across Hub visits)."""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any

_lock = threading.Lock()
_sessions: dict[str, dict[str, Any]] = {}
_TTL_SEC = 60 * 60 * 4  # 4h idle cleanup


def _purge_locked() -> None:
    now = time.time()
    dead = [sid for sid, s in _sessions.items() if now - float(s.get("touched", 0)) > _TTL_SEC]
    for sid in dead:
        _sessions.pop(sid, None)


def create_session(
    *,
    page: str,
    user: dict[str, Any] | None,
    casino_id: str | None = None,
    casino_name: str | None = None,
) -> dict[str, Any]:
    first = _first_name(user)
    place = (casino_name or "").strip() or ("Casinos" if page == "casinos" else page)
    if casino_name:
        greeting = f"Hey {first}, looking for anything specific about {casino_name}?"
    else:
        greeting = f"Hey {first}, looking for anything specific on {place}?"

    sid = str(uuid.uuid4())
    rec = {
        "session_id": sid,
        "page": page,
        "casino_id": (casino_id or "").strip() or None,
        "casino_name": (casino_name or "").strip() or None,
        "user_email": (user or {}).get("email"),
        "user_name": (user or {}).get("name"),
        "greeting": greeting,
        "messages": [],
        "created": time.time(),
        "touched": time.time(),
    }
    with _lock:
        _purge_locked()
        _sessions[sid] = rec
    return {
        "session_id": sid,
        "page": page,
        "casino_id": rec["casino_id"],
        "casino_name": rec["casino_name"],
        "greeting": greeting,
    }


def get_session(session_id: str) -> dict[str, Any] | None:
    with _lock:
        _purge_locked()
        rec = _sessions.get(session_id)
        if not rec:
            return None
        rec["touched"] = time.time()
        return rec


def append_exchange(session_id: str, user_text: str, assistant: dict[str, Any]) -> None:
    with _lock:
        rec = _sessions.get(session_id)
        if not rec:
            return
        rec["touched"] = time.time()
        rec["messages"].append({"role": "user", "content": user_text})
        rec["messages"].append({"role": "assistant", **assistant})


def _first_name(user: dict[str, Any] | None) -> str:
    if not user:
        return "there"
    name = (user.get("name") or "").strip()
    if not name:
        email = (user.get("email") or "").strip()
        if email and "@" in email:
            return email.split("@", 1)[0].split(".", 1)[0].capitalize() or "there"
        return "there"
    return name.split()[0]
