from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from app.assistant import config

_ENV_LINE = re.compile(r"^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")
_MASK = "••••••••••••"


def _env_path() -> Path:
    return config.workspace_root() / ".env"


def _parse_lines(text: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for line in text.splitlines():
        m = _ENV_LINE.match(line)
        if not m:
            continue
        key = m.group(2)
        raw_val = m.group(3).strip()
        if (raw_val.startswith('"') and raw_val.endswith('"')) or (
            raw_val.startswith("'") and raw_val.endswith("'")
        ):
            raw_val = raw_val[1:-1]
        rows.append({"key": key, "value": raw_val, "masked": _should_mask(key)})
    return rows


def _should_mask(key: str) -> bool:
    upper = key.upper()
    if upper.endswith("_URL") and "SECRET" not in upper and "KEY" not in upper and "PASSWORD" not in upper:
        return False
    return any(token in upper for token in ("KEY", "SECRET", "PASSWORD", "TOKEN", "CREDENTIAL"))


def list_secrets() -> dict[str, Any]:
    path = _env_path()
    if not path.is_file():
        return {"path": ".env", "exists": False, "variables": []}
    rows = _parse_lines(path.read_text(encoding="utf-8", errors="replace"))
    out = []
    for row in rows:
        display = _MASK if row["masked"] and row["value"] else row["value"]
        out.append({"key": row["key"], "value": display, "masked": row["masked"], "has_value": bool(row["value"])})
    return {"path": ".env", "exists": True, "variables": out}


def save_secrets(updates: list[dict[str, str]]) -> dict[str, Any]:
    path = _env_path()
    existing: dict[str, str] = {}
    order: list[str] = []
    if path.is_file():
        for row in _parse_lines(path.read_text(encoding="utf-8", errors="replace")):
            existing[row["key"]] = row["value"]
            order.append(row["key"])

    for item in updates:
        key = (item.get("key") or "").strip()
        if not key or not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", key):
            continue
        value = item.get("value")
        if value is None:
            continue
        if value == _MASK:
            continue
        if key not in order:
            order.append(key)
        existing[key] = value

    lines = [f"{k}={existing[k]}" for k in order if k in existing]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    return list_secrets()
