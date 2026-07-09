"""Resolve and authorize vendor media paths (logos, cabinet images)."""

from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path, PurePosixPath

from app import mssql

_SAFE_REL = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_ ./\-]*$")


def catalog() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def media_root() -> Path | None:
    for key in ("MEDIA_ROOT", "TABLEAU_IMAGES_ROOT"):
        val = (os.environ.get(key) or "").strip()
        if val:
            p = Path(val)
            if p.is_dir():
                return p.resolve()
    for candidate in (
        "/media/tableau-images",
        r"Z:\Paul Collins\tableau images",
        r"M:\Paul Collins\tableau images",
        r"G:\Paul Collins\tableau images",
        "/mnt/m/Paul Collins/tableau images",
        "/mnt/z/Paul Collins/tableau images",
        "/mnt/g/Paul Collins/tableau images",
    ):
        p = Path(candidate)
        if p.is_dir():
            return p.resolve()
    return None


def normalize_relative_path(raw: str) -> str:
    rel = raw.strip().replace("\\", "/").lstrip("/")
    if not rel or ".." in rel.split("/"):
        raise ValueError("invalid media path")
    parts = PurePosixPath(rel).parts
    if not parts:
        raise ValueError("invalid media path")
    if not _SAFE_REL.match(rel):
        raise ValueError("invalid media path characters")
    return PurePosixPath(*parts).as_posix()


@lru_cache(maxsize=2048)
def is_registered_media_path(rel_path: str) -> bool:
    row = mssql.query(
        """
        SELECT CASE
            WHEN EXISTS (
                SELECT 1 FROM vendors.vendors
                WHERE logo_media_path = %s
            ) THEN 1
            WHEN EXISTS (
                SELECT 1 FROM vendors.cabinets
                WHERE image_media_path = %s
            ) THEN 1
            ELSE 0
        END AS ok
        """,
        (rel_path, rel_path),
        database=catalog(),
        profile="field",
        load_env=False,
    )[0]
    return bool(row.get("ok"))


def resolve_media_file(rel_path: str) -> Path:
    rel = normalize_relative_path(rel_path)
    if not is_registered_media_path(rel):
        raise FileNotFoundError(rel_path)
    root = media_root()
    if root is None:
        raise FileNotFoundError("MEDIA_ROOT not configured")
    full = (root / Path(*PurePosixPath(rel).parts)).resolve()
    if not str(full).startswith(str(root)):
        raise FileNotFoundError(rel_path)
    if not full.is_file():
        raise FileNotFoundError(rel_path)
    return full
