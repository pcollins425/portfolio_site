from __future__ import annotations

from typing import Any

from app.assistant import config, runs, sessions


def health() -> dict[str, Any]:
    runs.clear_stale_active_runs()
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


def _tool_label(name: str, status: str) -> str:
    clean = (name or "tool").replace("_", " ").strip()
    if status == "running":
        return f"Using {clean}…"
    if status == "error":
        return f"{clean} failed"
    return f"Finished {clean}"


def _events_from_sdk_message(message: Any) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    msg_type = getattr(message, "type", None)

    if msg_type == "thinking":
        text = (getattr(message, "text", None) or "").strip()
        events.append(
            {
                "type": "thinking",
                "text": text or "Thinking…",
            }
        )
        return events

    if msg_type == "tool_call":
        name = getattr(message, "name", "tool") or "tool"
        status = getattr(message, "status", "running") or "running"
        events.append(
            {
                "type": "activity",
                "activity": "tool",
                "name": name,
                "status": status,
                "label": _tool_label(name, status),
            }
        )
        return events

    if msg_type == "status":
        label = (getattr(message, "message", None) or "").strip()
        if not label:
            label = (getattr(message, "status", None) or "Working").replace("_", " ")
        events.append(
            {
                "type": "activity",
                "activity": "status",
                "label": label,
            }
        )
        return events

    if msg_type == "assistant":
        content = getattr(message, "message", None)
        blocks = getattr(content, "content", None) if content else None
        for block in blocks or []:
            if getattr(block, "type", None) != "text":
                continue
            text = getattr(block, "text", None)
            if text:
                events.append({"type": "text", "text": text})
        return events

    return events


def _run_agent_once(
    rec: runs.RunRecord,
    prompt: str,
    *,
    force_recreate: bool = False,
) -> str:
    from cursor_sdk import CursorAgentError

    api_key = config.cursor_api_key()
    if not api_key:
        raise CursorAgentError("CURSOR_API_KEY is not configured on the API server")

    assistant_chunks: list[str] = []
    stored_agent_id = None if force_recreate else sessions.get_agent_id(rec.session_id)
    effective_prompt = prompt
    if force_recreate:
        sessions.clear_agent_id(rec.session_id)
        effective_prompt = _prompt_with_history(rec.session_id, prompt)
        rec.publish(
            {
                "type": "activity",
                "activity": "status",
                "label": "Reconnecting agent…",
            }
        )

    agent_ctx, resume_agent_id, recreated = _open_agent(
        api_key, rec.session_id, stored_agent_id
    )
    if recreated and stored_agent_id and not force_recreate:
        effective_prompt = _prompt_with_history(rec.session_id, prompt)

    with agent_ctx as agent:
        if resume_agent_id is None:
            sessions.set_agent_id(rec.session_id, agent.agent_id)

        run = agent.send(effective_prompt)
        for message in run.messages():
            for event in _events_from_sdk_message(message):
                if event.get("type") == "text":
                    assistant_chunks.append(str(event.get("text") or ""))
                rec.publish(event)

        result = run.wait()
        if result.status == "error":
            raise CursorAgentError(f"Run failed ({result.id})")

    return "".join(assistant_chunks).strip()


def execute_run(rec: runs.RunRecord, prompt: str) -> None:
    """Background worker — keeps running even if the SSE client disconnects."""
    from cursor_sdk import CursorAgentError
    from cursor_sdk.errors import AgentBusyError, InternalServerError

    stored_agent_id = sessions.get_agent_id(rec.session_id)
    retried = False

    try:
        while True:
            try:
                full_reply = _run_agent_once(rec, prompt, force_recreate=retried)
                if full_reply:
                    sessions.append_message(rec.session_id, "assistant", full_reply)
                runs.finish_run(rec, "finished")
                return
            except (InternalServerError, AgentBusyError) as err:
                if not retried and stored_agent_id:
                    retried = True
                    stored_agent_id = None
                    rec.publish(
                        {
                            "type": "activity",
                            "activity": "status",
                            "label": "Recovering session…",
                        }
                    )
                    continue
                raise err
            except CursorAgentError as err:
                if not retried and stored_agent_id:
                    retried = True
                    stored_agent_id = None
                    rec.publish(
                        {
                            "type": "activity",
                            "activity": "status",
                            "label": "Recovering session…",
                        }
                    )
                    continue
                rec.publish(
                    {
                        "type": "error",
                        "message": err.message,
                        "retryable": err.is_retryable,
                    }
                )
                runs.finish_run(rec, "error")
                return
    except CursorAgentError as err:
        rec.publish(
            {
                "type": "error",
                "message": err.message,
                "retryable": err.is_retryable,
            }
        )
        runs.finish_run(rec, "error")
    except Exception as err:
        rec.publish({"type": "error", "message": str(err)})
        runs.finish_run(rec, "error")


def begin_message(session_id: str, content: str) -> runs.RunRecord:
    """Validate, persist the user turn, and start (or attach to) a background run."""
    prompt = content.strip()
    if not prompt:
        raise ValueError("Message cannot be empty")

    existing = runs.get_active_run(session_id)
    if existing:
        return existing

    sessions.append_message(session_id, "user", prompt)

    api_key = config.cursor_api_key()
    if not api_key:
        raise RuntimeError("CURSOR_API_KEY is not configured on the API server")
    if not config.sdk_installed():
        raise RuntimeError("cursor-sdk is not installed (pip install cursor-sdk)")

    rec = runs.start_run(session_id, prompt)
    if rec is None:
        existing = runs.get_active_run(session_id)
        if existing:
            return existing
        raise RuntimeError("Could not start assistant run")
    return rec
