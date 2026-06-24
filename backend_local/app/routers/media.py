"""Serve vendor logo and cabinet images registered in vendors.* media path columns."""

from __future__ import annotations

import mimetypes

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.media_paths import media_root, resolve_media_file

router = APIRouter(prefix="/api/media", tags=["media"])


@router.get("/health")
def media_health():
    import os

    root = media_root()
    probe = (os.environ.get("MEDIA_HEALTH_PROBE") or "logos/logo_AGS.png").strip()
    probe_ok = bool(root and probe and (root / probe).is_file())
    nas = bool((os.environ.get("NAS_MEDIA_SHARE") or "").strip())
    if root is None:
        ok = False
    elif nas:
        ok = probe_ok
    else:
        ok = True
    return {
        "ok": ok,
        "media_root": str(root) if root else None,
        "nas_mount": nas,
        "probe": probe,
        "probe_ok": probe_ok,
    }


@router.get("/{media_path:path}")
def get_media(media_path: str):
    try:
        full = resolve_media_file(media_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="media not found") from exc

    media_type, _ = mimetypes.guess_type(str(full))
    return FileResponse(
        full,
        media_type=media_type or "application/octet-stream",
        headers={"Cache-Control": "private, max-age=86400"},
    )
