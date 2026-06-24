"""Serve vendor logo and cabinet images registered in vendors.* media path columns."""

from __future__ import annotations

import io
import mimetypes
import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse

from app.media_paths import is_registered_media_path, media_root, normalize_relative_path, resolve_media_file
from app.nas_smb import read_smb_file, smb_display_root, smb_enabled, smb_file_exists

router = APIRouter(prefix="/api/media", tags=["media"])


def _probe_rel() -> str:
    return (os.environ.get("MEDIA_HEALTH_PROBE") or "logos/logo_AGS.png").strip()


@router.get("/health")
def media_health():
    probe = _probe_rel()
    mode = (os.environ.get("NAS_MEDIA_MODE") or "filesystem").strip().lower()

    if smb_enabled():
        try:
            probe_ok = bool(probe and smb_file_exists(probe))
            root = smb_display_root()
            ok = probe_ok
        except Exception:
            probe_ok = False
            root = smb_display_root()
            ok = False
        return {
            "ok": ok,
            "media_root": root,
            "media_mode": "smb",
            "probe": probe,
            "probe_ok": probe_ok,
        }

    root = media_root()
    probe_ok = bool(root and probe and (root / probe).is_file())
    if root is None:
        ok = False
    elif mode == "wsl":
        ok = probe_ok
    else:
        ok = True
    return {
        "ok": ok,
        "media_root": str(root) if root else None,
        "media_mode": mode,
        "probe": probe,
        "probe_ok": probe_ok,
    }


@router.get("/{media_path:path}")
def get_media(media_path: str):
    try:
        rel = normalize_relative_path(media_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not is_registered_media_path(rel):
        raise HTTPException(status_code=404, detail="media not found")

    media_type, _ = mimetypes.guess_type(rel)
    headers = {"Cache-Control": "private, max-age=86400"}

    if smb_enabled():
        try:
            data = read_smb_file(rel)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail="media not found") from exc
        except Exception as exc:
            raise HTTPException(status_code=503, detail=f"NAS read failed: {exc}") from exc
        return StreamingResponse(io.BytesIO(data), media_type=media_type or "application/octet-stream", headers=headers)

    try:
        full = resolve_media_file(media_path)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="media not found") from exc

    return FileResponse(
        full,
        media_type=media_type or "application/octet-stream",
        headers=headers,
    )
