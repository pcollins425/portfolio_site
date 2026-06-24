"""Read vendor media directly from NAS over SMB (no filesystem mount)."""

from __future__ import annotations

import os
import threading

import smbclient

from app.media_paths import normalize_relative_path

_session_lock = threading.Lock()
_session_ready = False


def smb_enabled() -> bool:
    return (os.environ.get("NAS_MEDIA_MODE") or "").strip().lower() == "smb"


def _share_host() -> str:
    share = (os.environ.get("NAS_MEDIA_SHARE") or "").strip().replace("\\", "/")
    if share.startswith("//"):
        share = share[2:]
    host = share.split("/", 1)[0]
    if not host:
        raise RuntimeError("NAS_MEDIA_SHARE is invalid")
    return host


def _smb_uri(rel_path: str) -> str:
    share = (os.environ.get("NAS_MEDIA_SHARE") or "").strip().replace("\\", "/")
    if not share.startswith("//"):
        share = f"//{share.lstrip('/')}"
    subpath = (os.environ.get("NAS_MEDIA_SUBPATH") or "Paul Collins/tableau images").strip("/")
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
        username = (os.environ.get("NAS_MEDIA_USERNAME") or "").strip()
        password = (os.environ.get("NAS_MEDIA_PASSWORD") or "")
        if not username or not password:
            raise RuntimeError("NAS_MEDIA_USERNAME and NAS_MEDIA_PASSWORD required for SMB mode")
        host = _share_host()
        kwargs: dict = {
            "username": username,
            "password": password,
        }
        domain = (os.environ.get("NAS_MEDIA_DOMAIN") or "").strip()
        if domain and "\\" not in username:
            kwargs["username"] = f"{domain}\\{username}"
        port = (os.environ.get("NAS_MEDIA_PORT") or "").strip()
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
        raise FileNotFoundError(rel_path) from exc


def smb_display_root() -> str:
    share = (os.environ.get("NAS_MEDIA_SHARE") or "").strip().replace("\\", "/")
    subpath = (os.environ.get("NAS_MEDIA_SUBPATH") or "").strip("/")
    if subpath:
        return f"{share}/{subpath}"
    return share
