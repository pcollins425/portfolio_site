from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from app.assistant import config

_lock = Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _path() -> Path:
    return config.sessions_file()


def _read_all() -> list[dict[str, Any]]:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        return []
    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        return []
    data = json.loads(raw)
    if not isinstance(data, list):
        raise RuntimeError(f"Invalid sessions store: {path}")
    return data


def _write_all(rows: list[dict[str, Any]]) -> None:
    path = _path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def _public(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "title": row.get("title") or "New conversation",
        "agent_id": row.get("agent_id"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "messages": list(row.get("messages") or []),
    }


def list_sessions() -> list[dict[str, Any]]:
    with _lock:
        rows = _read_all()
    rows.sort(key=lambda r: r.get("updated_at") or r.get("created_at") or "", reverse=True)
    return [_public(r) for r in rows]


def get_session(session_id: str) -> dict[str, Any] | None:
    with _lock:
        for row in _read_all():
            if row.get("id") == session_id:
                return _public(row)
    return None


def create_session(title: str | None = None) -> dict[str, Any]:
    session_id = str(uuid.uuid4())
    now = _now_iso()
    row = {
        "id": session_id,
        "title": (title or "New conversation").strip() or "New conversation",
        "agent_id": None,
        "created_at": now,
        "updated_at": now,
        "messages": [],
    }
    with _lock:
        rows = _read_all()
        rows.append(row)
        _write_all(rows)
    return _public(row)


def append_message(session_id: str, role: str, content: str) -> dict[str, Any]:
    with _lock:
        rows = _read_all()
        for row in rows:
            if row.get("id") != session_id:
                continue
            row.setdefault("messages", []).append({"role": role, "content": content})
            row["updated_at"] = _now_iso()
            if role == "user" and row.get("title") == "New conversation":
                text = " ".join(content.strip().split())
                row["title"] = text[:57].rstrip() + "..." if len(text) > 60 else (text or "New conversation")
            _write_all(rows)
            return _public(row)
    raise KeyError(session_id)


def set_agent_id(session_id: str, agent_id: str) -> None:
    with _lock:
        rows = _read_all()
        for row in rows:
            if row.get("id") != session_id:
                continue
            row["agent_id"] = agent_id
            row["updated_at"] = _now_iso()
            _write_all(rows)
            return
    raise KeyError(session_id)


def get_agent_id(session_id: str) -> str | None:
    with _lock:
        for row in _read_all():
            if row.get("id") == session_id:
                aid = row.get("agent_id")
                return str(aid) if aid else None
    return None
