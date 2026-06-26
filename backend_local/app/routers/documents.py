"""Serve contract PDFs registered in inventory.document."""

from __future__ import annotations

import io
import mimetypes
import os

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, StreamingResponse

from app.document_paths import is_registered_document_path, normalize_relative_path, resolve_document_file
from app.document_storage import display_root, file_exists, read_bytes, storage_mode

router = APIRouter(prefix="/api/documents", tags=["documents"])


def _probe_rel() -> str:
    return (os.environ.get("DOCS_HEALTH_PROBE") or "").strip()


@router.get("/health")
def documents_health():
    probe = _probe_rel()
    mode = storage_mode()

    if mode == "smb":
        try:
            probe_ok = bool(probe and file_exists(probe))
            root = display_root()
            ok = probe_ok if probe else bool(root)
        except Exception:
            probe_ok = False
            root = display_root()
            ok = False
        return {
            "ok": ok,
            "docs_root": root,
            "docs_mode": "smb",
            "probe": probe or None,
            "probe_ok": probe_ok if probe else None,
        }

    from app.document_paths import docs_root

    root = docs_root()
    probe_ok = bool(root and probe and (root / probe).is_file()) if probe else None
    ok = bool(root) if not probe else bool(probe_ok)
    return {
        "ok": ok,
        "docs_root": str(root) if root else None,
        "docs_mode": mode,
        "probe": probe or None,
        "probe_ok": probe_ok,
    }


@router.get("/{document_path:path}")
def get_document(document_path: str):
    try:
        rel = normalize_relative_path(document_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not is_registered_document_path(rel):
        raise HTTPException(status_code=404, detail="document not found")

    media_type, _ = mimetypes.guess_type(rel)
    headers = {
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": "inline",
    }

    try:
        data = read_bytes(rel)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="document not found") from exc
    except PermissionError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"NAS read failed: {exc}") from exc

    if storage_mode() == "smb":
        return StreamingResponse(
            io.BytesIO(data),
            media_type=media_type or "application/pdf",
            headers=headers,
        )

    try:
        full = resolve_document_file(document_path)
    except FileNotFoundError:
        return StreamingResponse(
            io.BytesIO(data),
            media_type=media_type or "application/pdf",
            headers=headers,
        )

    return FileResponse(
        full,
        media_type=media_type or "application/pdf",
        headers=headers,
    )
