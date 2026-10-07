"""DGS mail intake permissions (Workspace · Mail Intake)."""

from __future__ import annotations

MAIL_INTAKE_AREA = "dgs_mail_intake"

READ_LEVELS = frozenset({"READ_ONLY", "UPDATES_ONLY", "ADDS_AND_UPDATES", "ALL_CHANGES"})
WRITE_LEVELS = frozenset({"UPDATES_ONLY", "ADDS_AND_UPDATES", "ALL_CHANGES"})


def can_read(permissions: dict[str, str]) -> bool:
    return permissions.get(MAIL_INTAKE_AREA) in READ_LEVELS


def can_write(permissions: dict[str, str]) -> bool:
    return permissions.get(MAIL_INTAKE_AREA) in WRITE_LEVELS
