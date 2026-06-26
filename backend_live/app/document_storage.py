"""Read/write contract documents from NAS (SMB or local filesystem)."""

from __future__ import annotations

import os
from pathlib import Path, PurePosixPath

from app.document_paths import docs_root, normalize_relative_path
from app.nas_smb import (
    docs_smb_display_root,
    docs_smb_enabled,
    docs_smb_file_exists,
    docs_smb_ensure_parent,
    read_docs_smb_file,
    write_docs_smb_file,
)


def storage_mode() -> str:
    if docs_smb_enabled():
        return "smb"
    return (os.environ.get("NAS_DOCS_MODE") or os.environ.get("NAS_MEDIA_MODE") or "filesystem").strip().lower()


def display_root() -> str | None:
    if docs_smb_enabled():
        return docs_smb_display_root()
    root = docs_root()
    return str(root) if root else None


def file_exists(rel_path: str) -> bool:
    rel = normalize_relative_path(rel_path)
    if docs_smb_enabled():
        return docs_smb_file_exists(rel)
    root = docs_root()
    if root is None:
        return False
    return (root / Path(*PurePosixPath(rel).parts)).is_file()


def read_bytes(rel_path: str) -> bytes:
    rel = normalize_relative_path(rel_path)
    if docs_smb_enabled():
        return read_docs_smb_file(rel)
    full = _resolve_writable(rel)
    return full.read_bytes()


def write_bytes(rel_path: str, data: bytes) -> None:
    rel = normalize_relative_path(rel_path)
    if docs_smb_enabled():
        docs_smb_ensure_parent(rel)
        write_docs_smb_file(rel, data)
        return
    full = _resolve_writable(rel)
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
