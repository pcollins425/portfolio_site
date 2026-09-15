"""Per-table eMaint demo permissions (employees.roles / employee_roles format)."""

from __future__ import annotations

from app.permission_catalog import merge_permissions, parse_permissions_blob

READ_LEVELS = frozenset({"READ_ONLY", "UPDATES_ONLY", "ADDS_AND_UPDATES", "ALL_CHANGES"})
WRITE_LEVELS = frozenset({"UPDATES_ONLY", "ADDS_AND_UPDATES", "ALL_CHANGES"})

# Demo nav tables (see emaintdemov1/assets/demo.js NAV_ORDER).
DEMO_TABLE_IDS = (
    "projects",
    "work_orders",
    "field_techs",
    "compinfo",
    "inventory",
    "purchase_orders",
)


def permission_area(table_id: str) -> str:
    return f"emaint_demo_{table_id}"


def level_for_table(permissions: dict[str, str], table_id: str) -> str | None:
    return permissions.get(permission_area(table_id))


def can_read_table(permissions: dict[str, str], table_id: str) -> bool:
    if table_id == "field_techs" and level_for_table(permissions, "field_techs") is None:
        return level_for_table(permissions, "work_orders") in READ_LEVELS
    level = level_for_table(permissions, table_id)
    return level in READ_LEVELS if level else False


def can_write_table(permissions: dict[str, str], table_id: str) -> bool:
    level = level_for_table(permissions, table_id)
    return level in WRITE_LEVELS if level else False


def allowed_table_ids(permissions: dict[str, str]) -> list[str]:
    return [tid for tid in DEMO_TABLE_IDS if can_read_table(permissions, tid)]
