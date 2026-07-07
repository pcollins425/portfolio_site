from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.assistant import chat, files, runs, secrets, sessions
from app.auth_deps import require_demo_user

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


class CreateSessionBody(BaseModel):
    title: str | None = None


class SendMessageBody(BaseModel):
    content: str = Field(..., min_length=1)


class SecretUpdate(BaseModel):
    key: str = Field(..., min_length=1)
    value: str = ""


class SaveSecretsBody(BaseModel):
    variables: list[SecretUpdate] = Field(default_factory=list)


def _stream_response(event_iter):
    return StreamingResponse(
        event_iter,
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


@router.get("/health")
def assistant_health(
    _user: Annotated[dict[str, Any] | None, Depends(require_demo_user)],
):
    return chat.health()


@router.get("/sessions")
def list_sessions(
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    runs.clear_stale_active_runs()
    return {"sessions": sessions.list_sessions()}


@router.post("/sessions")
def create_session(
    body: CreateSessionBody | None = None,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    title = body.title if body else None
    return sessions.create_session(title=title)


@router.get("/sessions/{session_id}")
def get_session(
    session_id: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    runs.clear_stale_active_runs()
    session = sessions.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/sessions/{session_id}/messages")
def send_message(
    session_id: str,
    body: SendMessageBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    if sessions.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    try:
        rec = chat.begin_message(session_id, body.content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return _stream_response(runs.stream_run_events(rec.run_id))


@router.get("/sessions/{session_id}/run/stream")
def stream_active_run(
    session_id: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    if sessions.get_session(session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    rec = runs.get_active_run(session_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="No active run for this session")
    return _stream_response(runs.stream_run_events(rec.run_id))


@router.get("/workspace/tree")
def workspace_tree(
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    return files.list_tree()


@router.get("/workspace/file")
def workspace_file(
    path: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    try:
        return files.read_file_preview(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="File not found") from exc


@router.get("/secrets")
def get_secrets(
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    return secrets.list_secrets()


@router.put("/secrets")
def put_secrets(
    body: SaveSecretsBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    payload = [{"key": v.key, "value": v.value} for v in body.variables]
    return secrets.save_secrets(payload)
