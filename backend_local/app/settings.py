from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parents[1]


def load_local_env() -> None:
    """Load optional credential bundle first, then **`backend_*` `.env`** (overrides)."""
    extra = (os.environ.get("MASTER_CREDENTIALS_ENV") or "").strip()
    if extra:
        ep = Path(extra).expanduser()
        if ep.is_file():
            load_dotenv(ep, override=False)
    p = _ROOT / ".env"
    if p.is_file():
        load_dotenv(p, override=True)


def api_host() -> str:
    return (os.environ.get("API_HOST") or "127.0.0.1").strip()


def api_port() -> int:
    return int((os.environ.get("API_PORT") or "9002").strip())


def api_reload() -> bool:
    return (os.environ.get("API_RELOAD") or "true").strip().lower() in (
        "1",
        "true",
        "yes",
    )
