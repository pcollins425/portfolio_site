"""Read/write contract documents from NAS (SMB or local filesystem)."""

from __future__ import annotations

import os
import urllib.error
import urllib.request
from pathlib import Path, PurePosixPath
from urllib.parse import quote

from app.document_paths import docs_root, normalize_relative_path, resolve_compliance_file
from app.nas_smb import (
    docs_smb_display_root,
    docs_smb_enabled,
    docs_smb_file_exists,
    docs_smb_ensure_parent,
    read_docs_smb_file,
    write_docs_smb_file,
)


def storage_mode() -> str:
    if _compliance_http_base() and not docs_smb_enabled():
        return "compliance-http"
    if docs_smb_enabled():
        return "smb"
    return (os.environ.get("NAS_DOCS_MODE") or os.environ.get("NAS_MEDIA_MODE") or "filesystem").strip().lower()


def display_root() -> str | None:
    base = _compliance_http_base()
    if base:
        return base
    if docs_smb_enabled():
        return docs_smb_display_root()
    root = docs_root()
    return str(root) if root else None


def _is_compliance(rel: str) -> bool:
    return rel == "Compliance" or rel.startswith("Compliance/")


def _compliance_http_base() -> str | None:
    return (os.environ.get("COMPLIANCE_HTTP_BASE") or "").strip().rstrip("/") or None


def _compliance_http_url(rel: str) -> str:
    """``Compliance/Par Sheets/...`` → ``{base}/Par Sheets/...`` (each segment encoded)."""
    base = _compliance_http_base()
    if not base:
        raise FileNotFoundError("COMPLIANCE_HTTP_BASE not configured")
    tail = rel[len("Compliance/") :] if rel.startswith("Compliance/") else rel
    if not tail or tail == "Compliance":
        raise FileNotFoundError(rel)
    encoded = "/".join(quote(part, safe="") for part in PurePosixPath(tail).parts)
    return f"{base}/{encoded}"


def _http_read_compliance(rel: str) -> bytes:
    url = _compliance_http_url(rel)
    try:
        with urllib.request.urlopen(url, timeout=60) as resp:
            return resp.read()
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise FileNotFoundError(rel) from exc
        raise
    except OSError as exc:
        raise FileNotFoundError(f"Compliance proxy unreachable: {exc}") from exc


def file_exists(rel_path: str) -> bool:
    rel = normalize_relative_path(rel_path)
    if _is_compliance(rel) and _compliance_http_base():
        try:
            _http_read_compliance(rel)
            return True
        except FileNotFoundError:
            return False
    if docs_smb_enabled():
        return docs_smb_file_exists(rel)
    if _is_compliance(rel):
        try:
            return resolve_compliance_file(rel).is_file()
        except (FileNotFoundError, ValueError):
            return False
    root = docs_root()
    if root is None:
        return False
    return (root / Path(*PurePosixPath(rel).parts)).is_file()


def read_bytes(rel_path: str) -> bytes:
    rel = normalize_relative_path(rel_path)
    if _is_compliance(rel) and _compliance_http_base():
        return _http_read_compliance(rel)
    if docs_smb_enabled():
        return read_docs_smb_file(rel)
    full = resolve_compliance_file(rel) if _is_compliance(rel) else _resolve_writable(rel)
    return full.read_bytes()


def write_bytes(rel_path: str, data: bytes) -> None:
    rel = normalize_relative_path(rel_path)
    if _is_compliance(rel) and _compliance_http_base() and not docs_smb_enabled():
        # Host proxy is read-only; Theme Hub uploads still need SMB or a writable root.
        raise OSError(
            "Compliance writes are not available via COMPLIANCE_HTTP_BASE; "
            "file on the NAS host or enable NAS_DOCS_MODE=smb"
        )
    if docs_smb_enabled():
        docs_smb_ensure_parent(rel)
        write_docs_smb_file(rel, data)
        return
    full = resolve_compliance_file(rel) if _is_compliance(rel) else _resolve_writable(rel)
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(data)


def _resolve_writable(rel_path: str) -> Path:
    rel = normalize_relative_path(rel_path)
    root = docs_root()
    if root is None:
        raise FileNotFoundError("DOCS_ROOT not configured")
    full = (root / Path(*PurePosixPath(rel).parts)).resolve()
    if not str(full).startswith(str(root)):
        raise ValueError("invalid document path")
    return full
