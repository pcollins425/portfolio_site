from __future__ import annotations

import json
import threading
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

from app.assistant import sessions

RunStatus = Literal["running", "finished", "error"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


@dataclass
class RunRecord:
    run_id: str
    session_id: str
    status: RunStatus
    events: list[dict[str, Any]] = field(default_factory=list)
    started_at: str = ""
    finished_at: str | None = None
    _cond: threading.Condition = field(default_factory=threading.Condition, repr=False)

    def publish(self, event: dict[str, Any]) -> None:
        with self._cond:
            self.events.append(event)
            self._cond.notify_all()

    def wait_for_events(self, count: int, timeout: float = 1.0) -> None:
        with self._cond:
            if len(self.events) > count:
                return
            self._cond.wait(timeout=timeout)


_registry_lock = threading.Lock()
_by_session: dict[str, RunRecord] = {}
_by_id: dict[str, RunRecord] = {}


def get_active_run(session_id: str) -> RunRecord | None:
    with _registry_lock:
        rec = _by_session.get(session_id)
        if rec and rec.status == "running":
            return rec
        return None


def get_run(run_id: str) -> RunRecord | None:
    with _registry_lock:
        return _by_id.get(run_id)


def _register(rec: RunRecord) -> None:
    with _registry_lock:
        _by_session[rec.session_id] = rec
        _by_id[rec.run_id] = rec


def _unregister(rec: RunRecord) -> None:
    with _registry_lock:
        current = _by_session.get(rec.session_id)
        if current is rec:
            _by_session.pop(rec.session_id, None)
        _by_id.pop(rec.run_id, None)


def start_run(session_id: str, prompt: str) -> RunRecord | None:
    """Start a background agent run. Returns None if one is already active."""
    with _registry_lock:
        existing = _by_session.get(session_id)
        if existing and existing.status == "running":
            return None

    run_id = str(uuid.uuid4())
    rec = RunRecord(
        run_id=run_id,
        session_id=session_id,
        status="running",
        started_at=_now_iso(),
    )
    _register(rec)
    sessions.set_active_run(session_id, run_id, "running")

    rec.publish({"type": "run", "run_id": run_id, "status": "running"})
    rec.publish({"type": "activity", "activity": "status", "label": "Starting agent…"})

    from app.assistant import chat

    thread = threading.Thread(
        target=chat.execute_run,
        args=(rec, prompt),
        name=f"assistant-run-{run_id[:8]}",
        daemon=True,
    )
    thread.start()
    return rec


def finish_run(rec: RunRecord, status: RunStatus) -> None:
    rec.status = status
    rec.finished_at = _now_iso()
    rec.publish({"type": "status", "status": status})
    sessions.clear_active_run(rec.session_id)
    _unregister(rec)


def stream_run_events(run_id: str, *, from_index: int = 0) -> Iterator[str]:
    rec = get_run(run_id)
    if rec is None:
        yield sse({"type": "error", "message": "Run not found or already finished"})
        yield sse({"type": "status", "status": "error"})
        return

    idx = from_index
    while True:
        while idx < len(rec.events):
            yield sse(rec.events[idx])
            idx += 1
        if rec.status != "running":
            break
        rec.wait_for_events(idx)

    if idx == 0 and rec.status != "running":
        yield sse({"type": "error", "message": "Run not found or already finished"})
        yield sse({"type": "status", "status": "error"})


def clear_stale_active_runs() -> None:
    """Drop persisted 'running' flags that have no in-memory worker (e.g. after restart)."""
    for row in sessions.list_sessions():
        active = row.get("active_run") or {}
        if active.get("status") != "running":
            continue
        run_id = active.get("run_id")
        if run_id and get_run(str(run_id)):
            continue
        sessions.clear_active_run(row["id"])
