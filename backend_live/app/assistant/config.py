from __future__ import annotations

import os
from pathlib import Path


def workspace_root() -> Path:
    raw = (os.environ.get("ASSISTANT_WORKSPACE") or "").strip()
    if raw:
        return Path(raw).resolve()
    # Dev fallback: sibling cursor-assistant on E: (adjust on SQL server via env).
    here = Path(__file__).resolve()
    for candidate in (
        Path("/workspace"),  # Docker Compose mount (see repo-root docker-compose.yml)
        Path("E:/cursor-assistant"),
        Path("E:/cursor_assistant"),
        here.parents[4] / "cursor-assistant",
    ):
        if candidate.is_dir():
            return candidate.resolve()
    return Path.cwd().resolve()


def sessions_file() -> Path:
    override = (os.environ.get("ASSISTANT_SESSIONS_FILE") or "").strip()
    if override:
        return Path(override).resolve()
    data_dir = workspace_root() / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / "assistant_sessions.json"


def cursor_api_key() -> str | None:
    key = (os.environ.get("CURSOR_API_KEY") or "").strip()
    return key or None


def model_name() -> str:
    return (os.environ.get("ASSISTANT_MODEL") or "composer-2.5").strip()


def sdk_installed() -> bool:
    try:
        import cursor_sdk  # noqa: F401

        return True
    except ImportError:
        return False
