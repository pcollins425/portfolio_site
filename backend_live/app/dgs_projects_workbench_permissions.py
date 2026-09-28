"""DGS Project Workbench (proposal) permissions."""

from __future__ import annotations

WORKBENCH_AREA = "dgs_projects_workbench"

READ_LEVELS = frozenset({"READ_ONLY", "UPDATES_ONLY", "ADDS_AND_UPDATES", "ALL_CHANGES"})
WRITE_LEVELS = frozenset({"UPDATES_ONLY", "ADDS_AND_UPDATES", "ALL_CHANGES"})


def can_read(permissions: dict[str, str]) -> bool:
    return permissions.get(WORKBENCH_AREA) in READ_LEVELS


def can_write(permissions: dict[str, str]) -> bool:
    return permissions.get(WORKBENCH_AREA) in WRITE_LEVELS


def is_admin(user: dict | None) -> bool:
    """Testing stand-in: Admin Employees holders, or a role whose name says admin.

    They can operate every Workbench stage. Compliance and Ops accounts are
    not this. A missing user (local open access) is not treated as admin here;
    callers decide that separately.
    """
    if not user:
        return False
    role = str(user.get("role") or "")
    if "admin" in role.lower():
        return True
    permissions = user.get("permissions") or {}
    for area in ("employees", "roles"):
        if permissions.get(area) in READ_LEVELS:
            return True
    return False


def can_edit_compliance(user: dict | None) -> bool:
    if not user:
        return False
    return (user.get("permissions") or {}).get("compliance") in WRITE_LEVELS


def can_edit_ops(user: dict | None) -> bool:
    if not user:
        return False
    return (user.get("permissions") or {}).get("emaint_demo_projects") in WRITE_LEVELS
