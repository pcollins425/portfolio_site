"""Resolve filed parts-catalog PDFs under Analytics NAS parts_catalogs/."""

from __future__ import annotations

import base64
import os
import re
import shutil
import subprocess
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
    s = re.sub(r"^[A-Za-z]:/", "", s)
    s = re.sub(r"^/mnt/[a-z]/", "", s, flags=re.I)
    s = s.lstrip("/")
    rel = normalize_relative_path(s)
    if not rel.lower().startswith("parts_catalogs/"):
        raise ValueError("catalog path must be under parts_catalogs/")
    return rel


def _env_path(key: str) -> Path | None:
    val = (os.environ.get(key) or "").strip()
    if not val:
        return None
    p = Path(val)
    try:
        if p.is_dir():
            return p.resolve()
    except OSError:
        return None
    # Trust configured root even when the process cannot stat it yet (WSL ↔ Z:).
    return p


def catalogs_root() -> Path | None:
    for key in ("PARTS_CATALOGS_ROOT", "ANALYTICS_NAS_ROOT"):
        p = _env_path(key)
        if p is not None:
            # ANALYTICS_NAS_ROOT may be share root; prefer …/parts_catalogs
            name = p.name.lower()
            if name != "parts_catalogs":
                nested = p / "parts_catalogs"
                try:
                    if nested.is_dir():
                        return nested.resolve()
                except OSError:
                    pass
                if key == "PARTS_CATALOGS_ROOT":
                    return p
                return nested
            return p

    # Sibling of MEDIA_ROOT (Z:\Paul Collins\tableau images → Z:\parts_catalogs)
    media = _env_path("MEDIA_ROOT") or _env_path("TABLEAU_IMAGES_ROOT")
    if media is not None:
        # …/Paul Collins/tableau images → share root = parent of "Paul Collins"
        try:
            share = media.parent.parent
            candidate = share / "parts_catalogs"
            if candidate.is_dir():
                return candidate.resolve()
            return candidate
        except OSError:
            pass

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
    return None


def resolve_catalog_file(rel_under_catalogs: str) -> Path:
    """rel is parts_catalogs/... ; file lives under catalogs_root()/AGS/..."""
    rel = normalize_relative_path(rel_under_catalogs)
    if not rel.lower().startswith("parts_catalogs/"):
        raise FileNotFoundError(rel_under_catalogs)
    root = catalogs_root()
    if root is None:
        raise FileNotFoundError("PARTS_CATALOGS_ROOT not configured")
    rest = rel.split("/", 1)[1] if "/" in rel else ""
    if not rest:
        raise FileNotFoundError(rel_under_catalogs)
    full = (root / Path(*PurePosixPath(rest).parts))
    try:
        full_res = full.resolve()
        root_res = root.resolve() if root.exists() else root
        if root.exists() and not str(full_res).startswith(str(root_res)):
            raise FileNotFoundError(rel_under_catalogs)
        if full_res.is_file():
            return full_res
    except OSError:
        pass
    if full.is_file():
        return full
    raise FileNotFoundError(rel_under_catalogs)


def windows_path_for_rel(rel_under_catalogs: str) -> str:
    rel = normalize_relative_path(rel_under_catalogs)
    root = (os.environ.get("PARTS_CATALOGS_ROOT") or r"Z:\parts_catalogs").strip()
    rest = rel.split("/", 1)[1] if "/" in rel else ""
    return str(Path(root) / Path(*PurePosixPath(rest).parts))


def _powershell_read_bytes(win_path: str) -> bytes:
    """Read a Windows path via powershell.exe (works from WSL when Z: is mapped in Windows)."""
    ps = (
        "$ErrorActionPreference='Stop'; "
        f"$p = '{win_path.replace(chr(39), chr(39)+chr(39))}'; "
        "if (-not (Test-Path -LiteralPath $p)) { throw \"missing $p\" }; "
        "[Convert]::ToBase64String([System.IO.File]::ReadAllBytes($p))"
    )
    exe = shutil.which("powershell.exe") or shutil.which("pwsh.exe")
    if not exe:
        raise FileNotFoundError(win_path)
    proc = subprocess.run(
        [exe, "-NoProfile", "-Command", ps],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if proc.returncode != 0:
        raise FileNotFoundError(f"{win_path}: {proc.stderr.strip() or proc.stdout.strip()}")
    b64 = (proc.stdout or "").strip()
    if not b64:
        raise FileNotFoundError(win_path)
    return base64.b64decode(b64)


def _smb_read_bytes(rel_under_catalogs: str) -> bytes:
    """Read from Analytics share root (…/DGS_Analytics/parts_catalogs/…)."""
    from app.nas_smb import _ensure_session, _with_reconnect, _env, _is_auth_error, _is_transient_smb_error
    import smbclient

    rel = normalize_relative_path(rel_under_catalogs)
    share = _env("NAS_MEDIA_SHARE").replace("\\", "/")
    if not share:
        raise FileNotFoundError("NAS_MEDIA_SHARE not configured")
    if not share.startswith("//"):
        share = f"//{share.lstrip('/')}"
    uri = f"{share}/{rel}"

    def _read() -> bytes:
        with smbclient.open_file(uri, mode="rb") as handle:
            return handle.read()

    try:
        _ensure_session()
        return _with_reconnect(_read)
    except Exception as exc:
        if _is_auth_error(exc):
            raise PermissionError(f"NAS authentication or permission failed: {exc}") from exc
        if _is_transient_smb_error(exc):
            raise OSError(f"NAS connection failed after reconnect: {exc}") from exc
        raise FileNotFoundError(rel_under_catalogs) from exc


def read_catalog_bytes(rel_under_catalogs: str) -> bytes:
    """Load catalog PDF bytes — filesystem, then PowerShell Z:, then SMB share root."""
    rel = normalize_relative_path(rel_under_catalogs)
    if not rel.lower().startswith("parts_catalogs/"):
        raise FileNotFoundError(rel_under_catalogs)

    try:
        return resolve_catalog_file(rel).read_bytes()
    except FileNotFoundError:
        pass

    # SMB (Docker / live) when share creds exist
    if (os.environ.get("NAS_MEDIA_SHARE") or "").strip() and (
        (os.environ.get("NAS_MEDIA_MODE") or "").strip().lower() == "smb"
        or (os.environ.get("NAS_DOCS_MODE") or "").strip().lower() == "smb"
        or (os.environ.get("NAS_MEDIA_USERNAME") or "").strip()
    ):
        try:
            return _smb_read_bytes(rel)
        except FileNotFoundError:
            pass
        except PermissionError:
            raise
        except Exception:
            pass

    # WSL / Linux API talking to Windows-mapped Z:
    win = windows_path_for_rel(rel)
    return _powershell_read_bytes(win)
