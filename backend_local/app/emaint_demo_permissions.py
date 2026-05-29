"""Per-table eMaint demo permissions (employees.roles / employee_roles format)."""

from __future__ import annotations

READ_LEVELS = frozenset({"READ_ONLY", "UPDATES_ONLY", "ADDS_AND_UPDATES", "ALL_CHANGES"})
WRITE_LEVELS = frozenset({"UPDATES_ONLY", "ADDS_AND_UPDATES", "ALL_CHANGES"})

# Demo nav tables (see emaintdemov1/assets/demo.js NAV_ORDER).
DEMO_TABLE_IDS = (
    "projects",
    "work_orders",
    "compinfo",
    "inventory",
    "purchase_orders",
)


def permission_area(table_id: str) -> str:
    return f"emaint_demo_{table_id}"


def parse_permissions_blob(blob: str | None) -> dict[str, str]:
    if not blob:
        return {}
    out: dict[str, str] = {}
    for part in blob.split(","):
        piece = part.strip()
        if ":" not in piece:
            continue
        area, level = piece.split(":", 1)
        area = area.strip()
        level = level.strip()
        if area:
            out[area] = level
    return out


def merge_permissions(role_blob: str | None, override_blob: str | None) -> dict[str, str]:
    merged = parse_permissions_blob(role_blob)
    merged.update(parse_permissions_blob(override_blob))
    return merged


def level_for_table(permissions: dict[str, str], table_id: str) -> str | None:
    return permissions.get(permission_area(table_id))


def can_read_table(permissions: dict[str, str], table_id: str) -> bool:
    level = level_for_table(permissions, table_id)
    return level in READ_LEVELS if level else False


def can_write_table(permissions: dict[str, str], table_id: str) -> bool:
    level = level_for_table(permissions, table_id)
    return level in WRITE_LEVELS if level else False


def allowed_table_ids(permissions: dict[str, str]) -> list[str]:
    return [tid for tid in DEMO_TABLE_IDS if can_read_table(permissions, tid)]
