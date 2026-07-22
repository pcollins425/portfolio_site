"""DGS FSR review permissions."""

from __future__ import annotations

FSR_REVIEW_AREA = "dgs_fsr_review"

READ_LEVELS = frozenset({"READ_ONLY", "UPDATES_ONLY", "ADDS_AND_UPDATES", "ALL_CHANGES"})
WRITE_LEVELS = frozenset({"UPDATES_ONLY", "ADDS_AND_UPDATES", "ALL_CHANGES"})


def can_read(permissions: dict[str, str]) -> bool:
    return permissions.get(FSR_REVIEW_AREA) in READ_LEVELS


def can_write(permissions: dict[str, str]) -> bool:
    return permissions.get(FSR_REVIEW_AREA) in WRITE_LEVELS
