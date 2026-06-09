"""Slot Master UI permissions (employees.roles / employee_roles format)."""

from __future__ import annotations

AREA = "slot_master"

READ_LEVELS = frozenset({"READ_ONLY", "UPDATES_ONLY"})
WRITE_LEVELS = frozenset({"UPDATES_ONLY"})


def level(permissions: dict[str, str]) -> str | None:
    return permissions.get(AREA)


def can_read(permissions: dict[str, str]) -> bool:
    lvl = level(permissions)
    return lvl in READ_LEVELS if lvl else False


def can_write(permissions: dict[str, str]) -> bool:
    lvl = level(permissions)
    return lvl in WRITE_LEVELS if lvl else False
