"""Resolve filed parts-catalog PDFs under Z:\\parts_catalogs (Analytics NAS)."""

from __future__ import annotations

import os
import re
from pathlib import Path, PurePosixPath


def normalize_relative_path(raw: str) -> str:
    rel = (raw or "").strip().replace("\\", "/").lstrip("/")
    if not rel or ".." in rel.split("/"):
        raise ValueError("invalid catalog path")
    if any(ch in rel for ch in ("\x00", "\n", "\r")):
        raise ValueError("invalid catalog path")
    parts = PurePosixPath(rel).parts
    if not parts:
        raise ValueError("invalid catalog path")
    return PurePosixPath(*parts).as_posix()


def filed_path_to_rel(raw: str | None) -> str | None:
    """Turn Z:\\parts_catalogs\\… or parts_catalogs/… into a share-relative path."""
    if not raw or not str(raw).strip():
        return None
    s = str(raw).strip().replace("\\", "/")
    # strip drive / mount prefixes
    s = re.sub(r"^[A-Za-z]:/", "", s)
    s = re.sub(r"^/mnt/[a-z]/", "", s, flags=re.I)
    s = s.lstrip("/")
    rel = normalize_relative_path(s)
    if not rel.lower().startswith("parts_catalogs/"):
        raise ValueError("catalog path must be under parts_catalogs/")
    return rel


def catalogs_root() -> Path | None:
    for key in ("PARTS_CATALOGS_ROOT", "ANALYTICS_NAS_ROOT"):
        val = (os.environ.get(key) or "").strip()
        if val:
            p = Path(val)
            if p.is_dir():
                return p.resolve()
    for candidate in (
        r"Z:\parts_catalogs",
        r"M:\parts_catalogs",
        "/mnt/z/parts_catalogs",
        "/mnt/m/parts_catalogs",
    ):
        p = Path(candidate)
        try:
            if p.is_dir():
                return p.resolve()
        except OSError:
            continue
    # parent of parts_catalogs when PARTS points at share root
    for candidate in (r"Z:\\", r"M:\\", "/mnt/z", "/mnt/m"):
        p = Path(candidate) / "parts_catalogs"
        try:
            if p.is_dir():
                return p.resolve()
        except OSError:
            continue
    return None


def resolve_catalog_file(rel_under_catalogs: str) -> Path:
    """rel is parts_catalogs/... ; file lives under catalogs_root()/AGS/..."""
    rel = normalize_relative_path(rel_under_catalogs)
    if not rel.lower().startswith("parts_catalogs/"):
        raise FileNotFoundError(rel_under_catalogs)
    root = catalogs_root()
    if root is None:
        raise FileNotFoundError("PARTS_CATALOGS_ROOT not configured")
    # root is .../parts_catalogs — strip prefix
    rest = rel.split("/", 1)[1] if "/" in rel else ""
    if not rest:
        raise FileNotFoundError(rel_under_catalogs)
    full = (root / Path(*PurePosixPath(rest).parts)).resolve()
    if not str(full).startswith(str(root)):
        raise FileNotFoundError(rel_under_catalogs)
    if not full.is_file():
        raise FileNotFoundError(rel_under_catalogs)
    return full
