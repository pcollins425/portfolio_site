"""DGS Project Workbench (proposal) permissions."""

from __future__ import annotations

WORKBENCH_AREA = "dgs_projects_workbench"

READ_LEVELS = frozenset({"READ_ONLY", "UPDATES_ONLY", "ADDS_AND_UPDATES", "ALL_CHANGES"})
WRITE_LEVELS = frozenset({"UPDATES_ONLY", "ADDS_AND_UPDATES", "ALL_CHANGES"})


def can_read(permissions: dict[str, str]) -> bool:
    return permissions.get(WORKBENCH_AREA) in READ_LEVELS


def can_write(permissions: dict[str, str]) -> bool:
    return permissions.get(WORKBENCH_AREA) in WRITE_LEVELS
