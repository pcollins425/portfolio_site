"""Resolve and authorize contract document paths on NAS."""

from __future__ import annotations

import os
import re
from pathlib import Path, PurePosixPath

from app import mssql

_UPLOAD_SEGMENT = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_ \-+.()]*$")


def catalog() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def docs_subpath() -> str:
    return (os.environ.get("NAS_DOCS_SUBPATH") or "Paul Collins/contract documents").strip().strip("/")


def normalize_relative_path(raw: str) -> str:
    rel = (raw or "").strip().replace("\\", "/").lstrip("/")
    if not rel or ".." in rel.split("/"):
        raise ValueError("invalid document path")
    if any(ch in rel for ch in ("\x00", "\n", "\r")):
        raise ValueError("invalid document path")
    parts = PurePosixPath(rel).parts
    if not parts:
        raise ValueError("invalid document path")
    return PurePosixPath(*parts).as_posix()


def sanitize_path_segment(raw: str) -> str:
    seg = (raw or "").strip().replace("\\", "/").strip("/")
    if not seg:
        raise ValueError("invalid path segment")
    cleaned = re.sub(r"[^\w \-+.()]+", "_", seg)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        raise ValueError("invalid path segment")
    if not _UPLOAD_SEGMENT.match(cleaned):
        raise ValueError("invalid path segment characters")
    return cleaned


def sanitize_upload_filename(raw: str) -> str:
    name = (raw or "").strip().replace("\\", "/").split("/")[-1]
    if not name:
        raise ValueError("filename required")
    name = re.sub(r"[^\w \-+.()]+", "_", name)
    name = re.sub(r"\s+", " ", name).strip()
    if not name:
        raise ValueError("filename required")
    if not name.lower().endswith(".pdf"):
        name = f"{name}.pdf"
    return name


def build_upload_rel_path(
    *,
    role: str,
    vendor_name: str,
    agreement_id: str,
    filename: str,
    sequence_no: int | None = None,
) -> str:
    role_norm = role.strip().lower()
    if role_norm not in {"agreement", "bol"}:
        raise ValueError("role must be agreement or bol")
    folder = "agreements" if role_norm == "agreement" else "bol"
    vendor_seg = sanitize_path_segment(vendor_name)
    agree_seg = sanitize_path_segment(agreement_id)
    safe_name = sanitize_upload_filename(filename)
    if role_norm == "bol" and sequence_no is not None:
        stem = PurePosixPath(safe_name).stem
        safe_name = f"{sequence_no:02d}-{stem}.pdf"
    return normalize_relative_path(f"{folder}/{vendor_seg}/{agree_seg}/{safe_name}")


def docs_root() -> Path | None:
    for key in ("DOCS_ROOT", "CONTRACT_DOCS_ROOT"):
        val = (os.environ.get(key) or "").strip()
        if val:
            p = Path(val)
            if p.is_dir():
                return p.resolve()
    sub = docs_subpath()
    for candidate in (
        "/media/contract-documents",
        rf"Z:\{sub}",
        rf"M:\{sub}",
        rf"G:\{sub}",
        f"/mnt/z/{sub}",
        f"/mnt/m/{sub}",
        f"/mnt/g/{sub}",
    ):
        p = Path(candidate)
        try:
            if p.is_dir():
                return p.resolve()
        except OSError:
            continue
    return None


def is_registered_document_path(rel_path: str) -> bool:
    row = mssql.query(
        """
        SELECT CASE
            WHEN EXISTS (
                SELECT 1 FROM inventory.document
                WHERE nas_rel_path = %s
            ) THEN 1
            ELSE 0
        END AS ok
        """,
        (rel_path,),
        database=catalog(),
        profile="field",
        load_env=False,
    )[0]
    return bool(row.get("ok"))


def resolve_document_file(rel_path: str) -> Path:
    rel = normalize_relative_path(rel_path)
    if not is_registered_document_path(rel):
        raise FileNotFoundError(rel_path)
    root = docs_root()
    if root is None:
        raise FileNotFoundError("DOCS_ROOT not configured")
    full = (root / Path(*PurePosixPath(rel).parts)).resolve()
    if not str(full).startswith(str(root)):
        raise FileNotFoundError(rel_path)
    if not full.is_file():
        raise FileNotFoundError(rel_path)
    return full
