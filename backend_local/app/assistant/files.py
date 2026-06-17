from __future__ import annotations

from pathlib import Path
from typing import Any

from app.assistant import config

_SKIP_DIRS = {
    ".git",
    ".venv",
    ".venv-wsl",
    "__pycache__",
    "node_modules",
    ".cursor",
    "credentials",
    "pages_publish",
    "data",
    "logs",
    "demo",
    "deploy",
    "expense_processor",
    "expense_sheet_out_watcher",
    "master_revenue_dashboard",
}
_MAX_DEPTH = 5
_MAX_PREVIEW = 32_000


def _root() -> Path:
    return config.workspace_root()


def _resolve_relative(rel: str) -> Path:
    root = _root()
    clean = (rel or "").strip().replace("\\", "/").lstrip("/")
    target = (root / clean).resolve()
    if target != root and root not in target.parents:
        raise ValueError("Path escapes workspace")
    return target


def _safe_is_dir(path: Path) -> bool:
    try:
        return path.is_dir()
    except OSError:
        return False


def _safe_is_file(path: Path) -> bool:
    try:
        return path.is_file()
    except OSError:
        return False


def _rel_path(root: Path, child: Path) -> str | None:
    try:
        return str(child.relative_to(root)).replace("\\", "/")
    except ValueError:
        try:
            return str(child.resolve().relative_to(root.resolve())).replace("\\", "/")
        except ValueError:
            return None


def list_tree() -> dict[str, Any]:
    root = _root()
    if not root.is_dir():
        return {
            "root": str(root),
            "name": root.name or str(root),
            "entries": [],
            "error": "Workspace directory not found",
        }

    def walk(dir_path: Path, depth: int) -> list[dict[str, Any]]:
        if depth > _MAX_DEPTH:
            return []
        entries: list[dict[str, Any]] = []
        try:
            children = sorted(dir_path.iterdir(), key=lambda p: p.name.lower())
        except OSError:
            return entries
        for child in children:
            try:
                name = child.name
                if _safe_is_dir(child) and name in _SKIP_DIRS:
                    continue
                if name.startswith(".") and name != ".env":
                    continue
                rel = _rel_path(root, child)
                if rel is None:
                    continue
                if _safe_is_dir(child):
                    entries.append(
                        {
                            "name": name,
                            "path": rel,
                            "type": "dir",
                            "children": walk(child, depth + 1),
                        }
                    )
                elif _safe_is_file(child):
                    entries.append({"name": name, "path": rel, "type": "file"})
            except OSError:
                continue
        return entries

    try:
        entries = walk(root, 0)
    except Exception as err:
        return {
            "root": str(root),
            "name": root.name or str(root),
            "entries": [],
            "error": f"{type(err).__name__}: {err}",
        }

    return {
        "root": str(root),
        "name": root.name or str(root),
        "entries": entries,
    }


def read_file_preview(rel: str) -> dict[str, Any]:
    path = _resolve_relative(rel)
    if not _safe_is_file(path):
        raise FileNotFoundError(rel)
    if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".zip", ".xlsx"}:
        try:
            size = path.stat().st_size
        except OSError:
            size = 0
        return {
            "path": rel,
            "binary": True,
            "preview": f"(Binary file — {size} bytes)",
        }
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as err:
        raise FileNotFoundError(rel) from err
    truncated = len(text) > _MAX_PREVIEW
    if truncated:
        text = text[:_MAX_PREVIEW] + "\n…"
    return {"path": rel, "binary": False, "preview": text, "truncated": truncated}
