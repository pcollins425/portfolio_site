#!/usr/bin/env python3
"""Run **local/test** portfolio API."""

from pathlib import Path

import uvicorn

from app import settings as app_settings

_ROOT = Path(__file__).resolve().parent

if __name__ == "__main__":
    app_settings.load_local_env()
    kwargs = {
        "host": app_settings.api_host(),
        "port": app_settings.api_port(),
        "reload": app_settings.api_reload(),
    }
    if app_settings.api_reload():
        kwargs["reload_dirs"] = [str(_ROOT / "app")]
    uvicorn.run("app.main:app", **kwargs)
