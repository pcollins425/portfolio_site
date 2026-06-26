"""Read vendor media directly from NAS over SMB (no filesystem mount)."""

from __future__ import annotations

import os
import threading

import smbclient

from app.media_paths import normalize_relative_path

_session_lock = threading.Lock()
_session_ready = False


def _env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).replace("\r", "").strip()


def smb_enabled() -> bool:
    return _env("NAS_MEDIA_MODE").lower() == "smb"


def _share_host() -> str:
    share = _env("NAS_MEDIA_SHARE").replace("\\", "/")
    if share.startswith("//"):
        share = share[2:]
    host = share.split("/", 1)[0]
    if not host:
        raise RuntimeError("NAS_MEDIA_SHARE is invalid")
    return host


def _smb_uri(rel_path: str) -> str:
    share = _env("NAS_MEDIA_SHARE").replace("\\", "/")
    if not share.startswith("//"):
        share = f"//{share.lstrip('/')}"
    subpath = _env("NAS_MEDIA_SUBPATH", "Paul Collins/tableau images").strip("/")
    rel = normalize_relative_path(rel_path)
    if subpath:
        return f"{share}/{subpath}/{rel}"
    return f"{share}/{rel}"


def _ensure_session() -> None:
    global _session_ready
    if _session_ready:
        return
    with _session_lock:
        if _session_ready:
            return
        username = _env("NAS_MEDIA_USERNAME")
        password = os.environ.get("NAS_MEDIA_PASSWORD") or ""
        password = password.replace("\r", "")
        if not username or not password:
            raise RuntimeError("NAS_MEDIA_USERNAME and NAS_MEDIA_PASSWORD required for SMB mode")
        host = _share_host()
        kwargs: dict = {
            "username": username,
            "password": password,
        }
        domain = _env("NAS_MEDIA_DOMAIN")
        if domain and "\\" not in username:
            kwargs["username"] = f"{domain}\\{username}"
        port = _env("NAS_MEDIA_PORT")
        if port:
            kwargs["port"] = int(port)
        smbclient.register_session(host, **kwargs)
        _session_ready = True


def smb_file_exists(rel_path: str) -> bool:
    _ensure_session()
    uri = _smb_uri(rel_path)
    try:
        smbclient.stat(uri)
        return True
    except OSError:
        return False


def read_smb_file(rel_path: str) -> bytes:
    _ensure_session()
    uri = _smb_uri(rel_path)
    try:
        with smbclient.open_file(uri, mode="rb") as handle:
            return handle.read()
    except OSError as exc:
        msg = str(exc).lower()
        if "access" in msg or "denied" in msg or "logon" in msg or "auth" in msg:
            raise PermissionError(f"NAS authentication or permission failed: {exc}") from exc
        raise FileNotFoundError(rel_path) from exc


def smb_display_root() -> str:
    share = _env("NAS_MEDIA_SHARE").replace("\\", "/")
    subpath = _env("NAS_MEDIA_SUBPATH").strip("/")
    if subpath:
        return f"{share}/{subpath}"
    return share


def docs_smb_enabled() -> bool:
    mode = _env("NAS_DOCS_MODE") or _env("NAS_MEDIA_MODE")
    return mode.lower() == "smb"


def _docs_subpath() -> str:
    return _env("NAS_DOCS_SUBPATH", "Paul Collins/contract documents").strip("/")


def _docs_smb_uri(rel_path: str) -> str:
    from app.document_paths import normalize_relative_path

    share = _env("NAS_MEDIA_SHARE").replace("\\", "/")
    if not share.startswith("//"):
        share = f"//{share.lstrip('/')}"
    subpath = _docs_subpath()
    rel = normalize_relative_path(rel_path)
    if subpath:
        return f"{share}/{subpath}/{rel}"
    return f"{share}/{rel}"


def docs_smb_display_root() -> str:
    share = _env("NAS_MEDIA_SHARE").replace("\\", "/")
    subpath = _docs_subpath()
    if subpath:
        return f"{share}/{subpath}"
    return share


def docs_smb_file_exists(rel_path: str) -> bool:
    _ensure_session()
    uri = _docs_smb_uri(rel_path)
    try:
        smbclient.stat(uri)
        return True
    except OSError:
        return False


def read_docs_smb_file(rel_path: str) -> bytes:
    _ensure_session()
    uri = _docs_smb_uri(rel_path)
    try:
        with smbclient.open_file(uri, mode="rb") as handle:
            return handle.read()
    except OSError as exc:
        msg = str(exc).lower()
        if "access" in msg or "denied" in msg or "logon" in msg or "auth" in msg:
            raise PermissionError(f"NAS authentication or permission failed: {exc}") from exc
        raise FileNotFoundError(rel_path) from exc


def docs_smb_ensure_parent(rel_path: str) -> None:
    from app.document_paths import normalize_relative_path

    _ensure_session()
    rel = normalize_relative_path(rel_path)
    parts = rel.split("/")
    if len(parts) <= 1:
        return
    share = _env("NAS_MEDIA_SHARE").replace("\\", "/")
    if not share.startswith("//"):
        share = f"//{share.lstrip('/')}"
    subpath = _docs_subpath()
    base = f"{share}/{subpath}" if subpath else share
    for i in range(1, len(parts)):
        folder = f"{base}/{'/'.join(parts[:i])}"
        try:
            smbclient.mkdir(folder)
        except OSError:
            pass


def write_docs_smb_file(rel_path: str, data: bytes) -> None:
    _ensure_session()
    uri = _docs_smb_uri(rel_path)
    try:
        with smbclient.open_file(uri, mode="wb") as handle:
            handle.write(data)
    except OSError as exc:
        msg = str(exc).lower()
        if "access" in msg or "denied" in msg or "logon" in msg or "auth" in msg:
            raise PermissionError(f"NAS authentication or permission failed: {exc}") from exc
        raise OSError(f"NAS write failed: {exc}") from exc
