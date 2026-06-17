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
        path = Path(override).resolve()
    elif Path("/workspace").is_dir():
        # Docker: keep session index off the git workspace mount (Windows bind mounts can be finicky).
        path = Path("/app/data/assistant_sessions/assistant_sessions.json")
    else:
        path = workspace_root() / "data" / "assistant_sessions.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def cursor_api_key() -> str | None:
    key = (os.environ.get("CURSOR_API_KEY") or "").strip()
    return key or None


def model_name() -> str:
    return (os.environ.get("ASSISTANT_MODEL") or "composer-2.5").strip()


def sdk_import_error() -> str | None:
    try:
        import cursor_sdk  # noqa: F401

        return None
    except Exception as err:
        return f"{type(err).__name__}: {err}"


def sdk_installed() -> bool:
    return sdk_import_error() is None
