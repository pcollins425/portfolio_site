"""Page Ask AI API — Casinos pilot (Script → Ollama → Cursor ladder)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth_deps import require_demo_user
from app.page_chat import contracts, engine, ollama, sessions
from app.page_chat.contracts import PAGE_CASINOS

router = APIRouter(prefix="/api/page-chat", tags=["page-chat"])


class CreateSessionBody(BaseModel):
    page: str = Field(default=PAGE_CASINOS, description="v1: casinos only")
    casino_id: str | None = Field(default=None, description="CT-* when a row/hub is selected")
    casino_name: str | None = None


class SendMessageBody(BaseModel):
    content: str = Field(..., min_length=1)


@router.get("/health")
def health(user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None):
    _assert_signed_in(user)
    ollama_status = ollama.ping()
    return {
        "ok": True,
        "page": PAGE_CASINOS,
        "ollama_model": ollama.model_name(),
        "ollama": ollama_status,
        "router": "stub_then_ollama",
        "escalation": "script → ollama → cursor(not wired)",
    }


@router.get("/contracts")
def get_contracts(user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None):
    """Public JSON contracts for Casino verbs (dev + future Ollama system prompt)."""
    _assert_signed_in(user)
    return contracts.contracts_public()


@router.post("/sessions")
def create_session(
    body: CreateSessionBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_signed_in(user)
    page = (body.page or PAGE_CASINOS).strip().lower()
    if page != PAGE_CASINOS:
        raise HTTPException(status_code=400, detail="v1 only supports page=casinos")
    return sessions.create_session(
        page=page,
        user=user,
        casino_id=body.casino_id,
        casino_name=body.casino_name,
    )


@router.get("/sessions/{session_id}")
def get_session(
    session_id: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_signed_in(user)
    rec = sessions.get_session(session_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id": rec["session_id"],
        "page": rec["page"],
        "casino_id": rec.get("casino_id"),
        "casino_name": rec.get("casino_name"),
        "greeting": rec.get("greeting"),
        "message_count": len(rec.get("messages") or []),
    }


@router.post("/sessions/{session_id}/messages")
def send_message(
    session_id: str,
    body: SendMessageBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_signed_in(user)
    return engine.process_message(session_id, body.content, user=user)


def _assert_signed_in(user: dict[str, Any] | None) -> None:
    """v1: Casinos browse = any signed-in employee (org default). Auth-off → user None OK."""
    # require_demo_user already 401 when auth on and missing; nothing else for v1.
    return
