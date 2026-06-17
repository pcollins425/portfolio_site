from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Any

from app.assistant import config, sessions


def health() -> dict[str, Any]:
    key = config.cursor_api_key()
    sdk_error = config.sdk_import_error()
    try:
        root = config.workspace_root()
        out: dict[str, Any] = {
            "ok": root.is_dir() and sdk_error is None,
            "workspace": str(root),
            "workspace_exists": root.is_dir(),
            "sessions_file": str(config.sessions_file()),
            "cursor_api_key_configured": bool(key),
            "cursor_sdk_installed": sdk_error is None,
            "model": config.model_name(),
        }
        if sdk_error:
            out["cursor_sdk_error"] = sdk_error
        try:
            out["session_count"] = len(sessions.list_sessions())
        except OSError as err:
            out["ok"] = False
            out["session_error"] = f"{type(err).__name__}: {err}"
            out["session_count"] = 0
        return out
    except Exception as err:
        out = {
            "ok": False,
            "error": f"{type(err).__name__}: {err}",
            "workspace_exists": False,
            "cursor_api_key_configured": bool(key),
            "cursor_sdk_installed": sdk_error is None,
            "session_count": 0,
        }
        if sdk_error:
            out["cursor_sdk_error"] = sdk_error
        return out


def _sse(event: dict[str, Any]) -> str:
    return f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


def _prompt_with_history(session_id: str, prompt: str) -> str:
    """Inject prior UI messages when the SDK agent must be recreated."""
    session = sessions.get_session(session_id)
    if not session:
        return prompt
    prior: list[dict[str, Any]] = []
    for message in session.get("messages") or []:
        role = message.get("role")
        content = (message.get("content") or "").strip()
        if role in {"user", "assistant"} and content:
            prior.append({"role": role, "content": content})
    if prior and prior[-1]["role"] == "user" and prior[-1]["content"] == prompt.strip():
        prior = prior[:-1]
    if not prior:
        return prompt
    lines = ["Continue this conversation. Prior messages:", ""]
    for message in prior:
        label = "User" if message["role"] == "user" else "Assistant"
        lines.append(f"{label}: {message['content']}")
        lines.append("")
    lines.append(f"User: {prompt}")
    return "\n".join(lines)


def _open_agent(api_key: str, session_id: str, agent_id: str | None):
    from cursor_sdk import Agent, AgentOptions
    from cursor_sdk.errors import AgentNotFoundError

    local = config.local_agent_options()
    options = AgentOptions(
        api_key=api_key,
        local=local,
        model=config.model_name(),
    )
    if agent_id:
        try:
            return Agent.resume(agent_id, options), agent_id, False
        except AgentNotFoundError:
            sessions.clear_agent_id(session_id)
    agent_ctx = Agent.create(
        model=config.model_name(),
        api_key=api_key,
        local=local,
    )
    return agent_ctx, None, True


def stream_message(session_id: str, content: str) -> Iterator[str]:
    prompt = content.strip()
    if not prompt:
        yield _sse({"type": "error", "message": "Message cannot be empty"})
        return

    try:
        sessions.append_message(session_id, "user", prompt)
    except KeyError:
        yield _sse({"type": "error", "message": "Session not found"})
        return

    api_key = config.cursor_api_key()
    if not api_key:
        yield _sse(
            {
                "type": "error",
                "message": "CURSOR_API_KEY is not configured on the API server",
            }
        )
        yield _sse({"type": "status", "status": "error"})
        return

    if not config.sdk_installed():
        yield _sse(
            {
                "type": "error",
                "message": "cursor-sdk is not installed (pip install cursor-sdk)",
            }
        )
        yield _sse({"type": "status", "status": "error"})
        return

    yield _sse({"type": "status", "status": "running"})

    from cursor_sdk import CursorAgentError

    assistant_chunks: list[str] = []
    stored_agent_id = sessions.get_agent_id(session_id)
    effective_prompt = prompt

    try:
        agent_ctx, resume_agent_id, recreated = _open_agent(
            api_key, session_id, stored_agent_id
        )
        if recreated and stored_agent_id:
            effective_prompt = _prompt_with_history(session_id, prompt)

        with agent_ctx as agent:
            if resume_agent_id is None:
                sessions.set_agent_id(session_id, agent.agent_id)

            run = agent.send(effective_prompt)
            for message in run.messages():
                if message.type != "assistant":
                    continue
                for block in message.message.content:
                    if block.type != "text" or not block.text:
                        continue
                    assistant_chunks.append(block.text)
                    yield _sse({"type": "text", "text": block.text})

            result = run.wait()
            if result.status == "error":
                yield _sse(
                    {
                        "type": "error",
                        "message": f"Run failed ({result.id})",
                        "run_id": result.id,
                    }
                )
                yield _sse({"type": "status", "status": "error"})
                return

    except CursorAgentError as err:
        yield _sse(
            {
                "type": "error",
                "message": err.message,
                "retryable": err.is_retryable,
            }
        )
        yield _sse({"type": "status", "status": "error"})
        return
    except Exception as err:
        yield _sse({"type": "error", "message": str(err)})
        yield _sse({"type": "status", "status": "error"})
        return

    full_reply = "".join(assistant_chunks).strip()
    if full_reply:
        sessions.append_message(session_id, "assistant", full_reply)

    yield _sse({"type": "status", "status": "finished"})
