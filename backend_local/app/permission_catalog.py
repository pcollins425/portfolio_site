"""Permission catalog + one-level-per-area merge / escalation helpers.

Stored format stays AppSheet-compatible: comma-separated ``area: LEVEL``.
Overrides may use ``area: NONE`` to subtract a role grant for that area.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

# Levels shown in the admin UI (one per area).
LEVEL_NONE = "NONE"
LEVEL_READ = "READ_ONLY"
LEVEL_UPDATES = "UPDATES_ONLY"
LEVEL_ADDS = "ADDS_ONLY"
LEVEL_ADDS_UPDATES = "ADDS_AND_UPDATES"
LEVEL_ALL = "ALL_CHANGES"

STANDARD_LEVELS = (
    LEVEL_READ,
    LEVEL_UPDATES,
    LEVEL_ADDS,
    LEVEL_ADDS_UPDATES,
    LEVEL_ALL,
)

WRITE_LEVELS = frozenset({LEVEL_UPDATES, LEVEL_ADDS_UPDATES, LEVEL_ALL})
READ_LEVELS = frozenset(STANDARD_LEVELS)

EMPLOYEES_AREA = "employees"
ROLES_AREA = "roles"
ANALYST_AREA = "dgs_analyst"
COMMISSION_AREA = "dgs_commission"


@dataclass(frozen=True)
class CatalogArea:
    id: str
    label: str
    group: str
    levels: tuple[str, ...] = STANDARD_LEVELS


# Grouped by schema / module — UI renders these sections.
PERMISSION_CATALOG: tuple[CatalogArea, ...] = (
    CatalogArea("employees", "Employees", "employees"),
    CatalogArea("roles", "Roles", "employees"),
    CatalogArea("states", "States", "clients"),
    CatalogArea("casinos", "Casinos", "clients"),
    CatalogArea("tribes", "Tribes", "clients", (LEVEL_READ, LEVEL_UPDATES, LEVEL_ADDS_UPDATES, LEVEL_ALL)),
    CatalogArea("vendors", "Vendors", "vendors"),
    CatalogArea("cabinets", "Cabinets", "vendors"),
    CatalogArea("themes", "Themes", "vendors"),
    CatalogArea("slot_master", "Slot Master", "inventory"),
    CatalogArea("casino_master", "Casino Master", "inventory", (LEVEL_ADDS_UPDATES, LEVEL_ALL)),
    CatalogArea("full_slot_master", "Full Slot Master", "inventory", (LEVEL_ADDS_UPDATES, LEVEL_ALL)),
    CatalogArea("compliance", "Compliance", "compliance"),
    CatalogArea("bill_validators", "Bill Validators", "peripherals"),
    CatalogArea("printers", "Printers", "peripherals"),
    CatalogArea("order_details", "Order Details", "sales"),
    CatalogArea("sales_orders", "Sales Orders", "sales"),
    CatalogArea("activity", "Activity", "sales", (LEVEL_READ,)),
    CatalogArea("expenses", "Expenses", "finance"),
    CatalogArea("emaint_demo_projects", "Ops · Projects", "dgs_app"),
    CatalogArea("emaint_demo_work_orders", "Ops · Work Orders", "dgs_app"),
    CatalogArea("emaint_demo_field_techs", "Ops · Field Techs", "dgs_app"),
    CatalogArea("emaint_demo_compinfo", "Ops · Compinfo", "dgs_app"),
    CatalogArea("emaint_demo_inventory", "Ops · Inventory", "dgs_app"),
    CatalogArea("emaint_demo_purchase_orders", "Ops · Purchase Orders", "dgs_app"),
    CatalogArea("dgs_projects_calendar", "Projects · Calendar", "dgs_app", (LEVEL_READ, LEVEL_UPDATES, LEVEL_ADDS_UPDATES, LEVEL_ALL)),
    CatalogArea("dgs_projects_catalog", "Projects · Catalog", "dgs_app", (LEVEL_READ, LEVEL_UPDATES, LEVEL_ADDS_UPDATES, LEVEL_ALL)),
    CatalogArea("dgs_fsr_review", "FSR Review", "dgs_app"),
    CatalogArea("dgs_performance_intake", "Performance Intake", "dgs_app"),
    CatalogArea(ANALYST_AREA, "Analyst Queue", "dgs_app"),
    CatalogArea(COMMISSION_AREA, "Commission Queue", "dgs_app"),
    # Stored as bare AppSheet tokens (``email: approval``); dict key is the full token.
    CatalogArea("email: approval", "Email · Approval", "email", (LEVEL_READ,)),
    CatalogArea("email: legal", "Email · Legal", "email", (LEVEL_READ,)),
    CatalogArea("email: sales", "Email · Sales", "email", (LEVEL_READ,)),
    CatalogArea("email: order_signed", "Email · Order Signed", "email", (LEVEL_READ,)),
)

_EMAIL_FLAG_TOKENS = frozenset(
    a.id for a in PERMISSION_CATALOG if a.id.startswith("email:")
)


def catalog_payload() -> dict[str, Any]:
    groups: dict[str, list[dict[str, Any]]] = {}
    for area in PERMISSION_CATALOG:
        groups.setdefault(area.group, []).append(
            {
                "id": area.id,
                "label": area.label,
                "levels": list(area.levels),
            }
        )
    return {
        "levels": list(STANDARD_LEVELS),
        "none_token": LEVEL_NONE,
        "groups": [{"id": gid, "areas": areas} for gid, areas in groups.items()],
    }


def parse_permissions_blob(blob: str | None) -> dict[str, str]:
    """Parse ``area: LEVEL`` tokens. Email flags keep the full token as the area key."""
    if not blob:
        return {}
    out: dict[str, str] = {}
    for part in blob.split(","):
        piece = part.strip()
        if not piece:
            continue
        # Normalize spacing inside email tokens: ``email:approval`` → ``email: approval``
        lowered = piece.lower().replace("email:", "email: ")
        lowered = " ".join(lowered.split())
        if lowered in _EMAIL_FLAG_TOKENS or piece in _EMAIL_FLAG_TOKENS:
            key = piece if piece in _EMAIL_FLAG_TOKENS else lowered
            out[key] = LEVEL_READ
            continue
        if ":" not in piece:
            continue
        area, level = piece.split(":", 1)
        area = area.strip()
        level = level.strip()
        if area:
            out[area] = level
    return out


def serialize_permissions(mapping: dict[str, str] | None) -> str:
    if not mapping:
        return ""
    parts: list[str] = []
    for area in sorted(mapping.keys()):
        level = (mapping.get(area) or "").strip()
        if area in _EMAIL_FLAG_TOKENS:
            if level and level.upper() not in ("", LEVEL_NONE, "OFF"):
                parts.append(area)
            elif level.upper() == LEVEL_NONE:
                parts.append(f"{area}: {LEVEL_NONE}")
            continue
        if not level:
            continue
        if level.upper() == LEVEL_NONE:
            parts.append(f"{area}: {LEVEL_NONE}")
            continue
        parts.append(f"{area}: {level}")
    return ", ".join(parts)


def merge_permissions(role_blob: str | None, override_blob: str | None) -> dict[str, str]:
    """Role base + overrides. ``area: NONE`` removes the role grant for that area."""
    merged = parse_permissions_blob(role_blob)
    for area, level in parse_permissions_blob(override_blob).items():
        if (level or "").upper() == LEVEL_NONE:
            merged.pop(area, None)
        else:
            merged[area] = level
    return merged


def levels_actor_may_grant(actor_level: str | None) -> frozenset[str]:
    """Levels the actor may raise a target to (plus NONE for clear/subtract)."""
    if not actor_level:
        return frozenset({LEVEL_NONE})
    level = actor_level.strip()
    if level == LEVEL_ALL:
        return frozenset({*STANDARD_LEVELS, LEVEL_NONE})
    if level == LEVEL_ADDS_UPDATES:
        return frozenset({LEVEL_READ, LEVEL_UPDATES, LEVEL_ADDS, LEVEL_ADDS_UPDATES, LEVEL_NONE})
    if level == LEVEL_UPDATES:
        return frozenset({LEVEL_READ, LEVEL_UPDATES, LEVEL_NONE})
    if level == LEVEL_ADDS:
        return frozenset({LEVEL_READ, LEVEL_ADDS, LEVEL_NONE})
    if level == LEVEL_READ:
        return frozenset({LEVEL_READ, LEVEL_NONE})
    # Unknown / email flags: can only re-grant the same token or clear.
    return frozenset({level, LEVEL_NONE})


def can_grant(actor_effective: dict[str, str], area: str, requested_level: str | None) -> bool:
    """True if actor may set ``area`` to ``requested_level`` (None/empty/NONE = clear)."""
    req = (requested_level or LEVEL_NONE).strip().upper()
    if req in ("", LEVEL_NONE, "OFF"):
        return True
    allowed = levels_actor_may_grant(actor_effective.get(area))
    return req in {a.upper() for a in allowed} or requested_level in allowed


def validate_grant_map(
    actor_effective: dict[str, str],
    requested: dict[str, str | None],
) -> list[str]:
    """Return list of escalation error messages (empty = ok)."""
    errors: list[str] = []
    for area, level in requested.items():
        if level is None:
            continue
        if not can_grant(actor_effective, area, level):
            hold = actor_effective.get(area) or "none"
            errors.append(f"Cannot grant {area}: {level} (you hold {hold})")
    return errors


def overrides_from_effective(
    role_map: dict[str, str],
    desired_effective: dict[str, str | None],
) -> dict[str, str]:
    """Build override deltas so merge(role, overrides) == desired (missing = Off)."""
    areas = set(role_map) | {a for a, v in desired_effective.items() if v}
    deltas: dict[str, str] = {}
    for area in areas:
        role_level = role_map.get(area)
        desired = desired_effective.get(area)
        if desired is None or desired == "" or str(desired).upper() == "OFF":
            desired_norm = None
        elif str(desired).upper() == LEVEL_NONE:
            desired_norm = None
        else:
            desired_norm = str(desired).strip()

        if desired_norm == role_level:
            continue
        if desired_norm is None and role_level:
            deltas[area] = LEVEL_NONE
        elif desired_norm is None and not role_level:
            continue
        else:
            deltas[area] = desired_norm  # type: ignore[assignment]
    return deltas


def has_area_read(permissions: dict[str, str], area: str) -> bool:
    level = permissions.get(area)
    if not level:
        return False
    if area.startswith("email:"):
        return True
    return level in READ_LEVELS


def has_area_write(permissions: dict[str, str], area: str) -> bool:
    return permissions.get(area) in WRITE_LEVELS


def has_employees_read(permissions: dict[str, str]) -> bool:
    return has_area_read(permissions, EMPLOYEES_AREA)


def has_employees_write(permissions: dict[str, str]) -> bool:
    return has_area_write(permissions, EMPLOYEES_AREA)


def has_roles_read(permissions: dict[str, str]) -> bool:
    return has_area_read(permissions, ROLES_AREA)


def has_roles_write(permissions: dict[str, str]) -> bool:
    return has_area_write(permissions, ROLES_AREA)


def can_add_employees(permissions: dict[str, str]) -> bool:
    return permissions.get(EMPLOYEES_AREA) in {LEVEL_ADDS, LEVEL_ADDS_UPDATES, LEVEL_ALL}


def can_add_roles(permissions: dict[str, str]) -> bool:
    return permissions.get(ROLES_AREA) in {LEVEL_ADDS, LEVEL_ADDS_UPDATES, LEVEL_ALL}


def count_active_with_write(
    people: list[dict[str, Any]],
    area: str,
) -> int:
    """``people`` rows need role_permissions + override_permissions (+ active)."""
    n = 0
    for row in people:
        if not row.get("active"):
            continue
        eff = merge_permissions(row.get("role_permissions"), row.get("override_permissions"))
        if has_area_write(eff, area):
            n += 1
    return n
