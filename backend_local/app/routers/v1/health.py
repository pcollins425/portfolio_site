from __future__ import annotations

import sys

from fastapi import APIRouter

from app.settings import api_host, api_port

router = APIRouter()


@router.get("/health")
def health_v1():
    return {
        "ok": True,
        "environment": "local",
        "api_version": "v1",
        "bind": f"{api_host()}:{api_port()}",
        "python": sys.version.split()[0],
    }
