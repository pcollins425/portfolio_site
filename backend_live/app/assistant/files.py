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


def list_tree() -> dict[str, Any]:
    root = _root()

    def walk(dir_path: Path, depth: int) -> list[dict[str, Any]]:
        if depth > _MAX_DEPTH:
            return []
        entries: list[dict[str, Any]] = []
        try:
            children = sorted(dir_path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except OSError:
            return entries
        for child in children:
            name = child.name
            if child.is_dir() and name in _SKIP_DIRS:
                continue
            if name.startswith(".") and name != ".env":
                continue
            rel = str(child.relative_to(root)).replace("\\", "/")
            if child.is_dir():
                entries.append(
                    {
                        "name": name,
                        "path": rel,
                        "type": "dir",
                        "children": walk(child, depth + 1),
                    }
                )
            else:
                entries.append({"name": name, "path": rel, "type": "file"})
        return entries

    return {
        "root": str(root),
        "name": root.name or str(root),
        "entries": walk(root, 0),
    }


def read_file_preview(rel: str) -> dict[str, Any]:
    path = _resolve_relative(rel)
    if not path.is_file():
        raise FileNotFoundError(rel)
    if path.suffix.lower() in {".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".zip", ".xlsx"}:
        return {
            "path": rel,
            "binary": True,
            "preview": f"(Binary file — {path.stat().st_size} bytes)",
        }
    text = path.read_text(encoding="utf-8", errors="replace")
    truncated = len(text) > _MAX_PREVIEW
    if truncated:
        text = text[:_MAX_PREVIEW] + "\n…"
    return {"path": rel, "binary": False, "preview": text, "truncated": truncated}
