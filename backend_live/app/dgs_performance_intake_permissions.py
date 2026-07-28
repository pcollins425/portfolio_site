"""DGS performance intake confirmation permissions."""

from __future__ import annotations

PERF_INTAKE_AREA = "dgs_performance_intake"
# Bootstrap: FSR reviewers can open confirm links until area is seeded.
_FALLBACK_AREA = "dgs_fsr_review"

READ_LEVELS = frozenset({"READ_ONLY", "UPDATES_ONLY", "ADDS_AND_UPDATES", "ALL_CHANGES"})
WRITE_LEVELS = frozenset({"UPDATES_ONLY", "ADDS_AND_UPDATES", "ALL_CHANGES"})


def can_read(permissions: dict[str, str]) -> bool:
    return (
        permissions.get(PERF_INTAKE_AREA) in READ_LEVELS
        or permissions.get(_FALLBACK_AREA) in READ_LEVELS
    )


def can_write(permissions: dict[str, str]) -> bool:
    return (
        permissions.get(PERF_INTAKE_AREA) in WRITE_LEVELS
        or permissions.get(_FALLBACK_AREA) in WRITE_LEVELS
    )
