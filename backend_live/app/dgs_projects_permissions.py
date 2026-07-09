"""DGS Projects module permissions (employees.roles / employee_roles format).

Areas (v1 read-only):
  - dgs_projects_calendar  — projects.ims month calendar
  - dgs_projects_catalog   — projects.project_catalog + printout
The eMaint tab reuses ``emaint_demo_projects`` (existing grants).
"""

from __future__ import annotations

CALENDAR_AREA = "dgs_projects_calendar"
CATALOG_AREA = "dgs_projects_catalog"

READ_LEVELS = frozenset({"READ_ONLY", "UPDATES_ONLY", "ADDS_AND_UPDATES", "ALL_CHANGES"})


def can_read_calendar(permissions: dict[str, str]) -> bool:
    return permissions.get(CALENDAR_AREA) in READ_LEVELS


def can_read_catalog(permissions: dict[str, str]) -> bool:
    return permissions.get(CATALOG_AREA) in READ_LEVELS
