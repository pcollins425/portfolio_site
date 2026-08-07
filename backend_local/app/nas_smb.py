"""Read vendor media directly from NAS over SMB (no filesystem mount)."""

from __future__ import annotations

import os
import threading
from collections.abc import Callable
from typing import TypeVar

import smbclient

from app.media_paths import normalize_relative_path

_session_lock = threading.Lock()
_session_ready = False

T = TypeVar("T")


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


def _reset_session() -> None:
    """Drop cached SMB connections so the next call re-authenticates."""
    global _session_ready
    with _session_lock:
        try:
            smbclient.reset_connection_cache()
        except Exception:
            pass
        _session_ready = False


def _is_transient_smb_error(exc: BaseException) -> bool:
    """True when a stale/idle SMB session or TCP connection likely caused the failure."""
    if isinstance(exc, (BrokenPipeError, ConnectionError, TimeoutError)):
        return True
    msg = str(exc).lower()
    needles = (
        "broken pipe",
        "connection reset",
        "connection aborted",
        "connection refused",
        "timed out",
        "timeout",
        "session expired",
        "network_session_expired",
        "0xc000035c",
        "not connected",
        "socket",
        "errno 32",
        "errno 104",
        "errno 110",
        "forcibly closed",
    )
    return any(n in msg for n in needles)


def _is_auth_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return any(k in msg for k in ("access", "denied", "logon", "auth", "unauthorized"))


def _with_reconnect(operation: Callable[[], T]) -> T:
    """Run an SMB operation; on a stale session, reset and retry once."""
    try:
        _ensure_session()
        return operation()
    except Exception as first:
        if not _is_transient_smb_error(first):
            raise
        _reset_session()
        _ensure_session()
        return operation()


def smb_file_exists(rel_path: str) -> bool:
    uri = _smb_uri(rel_path)

    def _stat() -> bool:
        smbclient.stat(uri)
        return True

    try:
        return _with_reconnect(_stat)
    except OSError:
        return False


def read_smb_file(rel_path: str) -> bytes:
    uri = _smb_uri(rel_path)

    def _read() -> bytes:
        with smbclient.open_file(uri, mode="rb") as handle:
            return handle.read()

    try:
        return _with_reconnect(_read)
    except Exception as exc:
        if _is_auth_error(exc):
            raise PermissionError(f"NAS authentication or permission failed: {exc}") from exc
        if _is_transient_smb_error(exc):
            raise OSError(f"NAS connection failed after reconnect: {exc}") from exc
        if isinstance(exc, OSError):
            raise FileNotFoundError(rel_path) from exc
        raise


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
    uri = _docs_smb_uri(rel_path)

    def _stat() -> bool:
        smbclient.stat(uri)
        return True

    try:
        return _with_reconnect(_stat)
    except OSError:
        return False


def read_docs_smb_file(rel_path: str) -> bytes:
    uri = _docs_smb_uri(rel_path)

    def _read() -> bytes:
        with smbclient.open_file(uri, mode="rb") as handle:
            return handle.read()

    try:
        return _with_reconnect(_read)
    except Exception as exc:
        if _is_auth_error(exc):
            raise PermissionError(f"NAS authentication or permission failed: {exc}") from exc
        if _is_transient_smb_error(exc):
            raise OSError(f"NAS connection failed after reconnect: {exc}") from exc
        if isinstance(exc, OSError):
            raise FileNotFoundError(rel_path) from exc
        raise


def docs_smb_ensure_parent(rel_path: str) -> None:
    from app.document_paths import normalize_relative_path

    rel = normalize_relative_path(rel_path)
    parts = rel.split("/")
    if len(parts) <= 1:
        return
    share = _env("NAS_MEDIA_SHARE").replace("\\", "/")
    if not share.startswith("//"):
        share = f"//{share.lstrip('/')}"
    subpath = _docs_subpath()
    base = f"{share}/{subpath}" if subpath else share

    def _mkdirs() -> None:
        for i in range(1, len(parts)):
            folder = f"{base}/{'/'.join(parts[:i])}"
            try:
                smbclient.mkdir(folder)
            except OSError:
                pass

    _with_reconnect(_mkdirs)


def write_docs_smb_file(rel_path: str, data: bytes) -> None:
    uri = _docs_smb_uri(rel_path)

    def _write() -> None:
        with smbclient.open_file(uri, mode="wb") as handle:
            handle.write(data)

    try:
        _with_reconnect(_write)
    except Exception as exc:
        if _is_auth_error(exc):
            raise PermissionError(f"NAS authentication or permission failed: {exc}") from exc
        if _is_transient_smb_error(exc):
            raise OSError(f"NAS connection failed after reconnect: {exc}") from exc
        raise OSError(f"NAS write failed: {exc}") from exc
