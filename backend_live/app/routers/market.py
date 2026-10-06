"""Market tab — active Slot Master floor and casino agreement lists.

Units are active ``inventory.slot_master_migration`` rows joined to an asset.
House floor size and contracted vendors come from ``clients.casinos``.
Master Revenue is not a source.
"""

from __future__ import annotations

import os

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException

from app import mssql
from app import permission_catalog as cat
from app.auth_deps import require_area_read, require_demo_user

router = APIRouter(
    prefix="/api/market",
    tags=["market"],
    dependencies=[Depends(require_area_read(cat.PERFORMANCE_AREA))],
)

# Absence of these vendors is not an open market. They stay on the agreement
# list and still count in the floor charts when a machine is actually there.
UNIVERSAL_VENDOR_IDS = {
    "VT-008": "Lightning Gaming",
    "VT-023": "Spintec",
    "VT-024": "Light & Wonder",
}


def _catalog() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _field_query(sql: str, params=None):
    return mssql.query(sql, params=params, database=_catalog(), profile="field", load_env=False)


def _is_floor_machine(cabinet_name: str | None) -> bool:
    name = (cabinet_name or "").strip().lower()
    if "center" in name or "sign" in name:
        return False
    return True


def _vendor_ids(raw: Any) -> list[str]:
    if raw is None:
        return []
    return [part.strip() for part in str(raw).split(",") if part.strip()]


def _pct(part: float, whole: float) -> float:
    if whole <= 0:
        return 0.0
    return round(100.0 * part / whole, 1)


def build_market_snapshot(
    machine_rows: list[dict],
    casino_rows: list[dict],
    vendor_names: dict[str, str],
) -> dict:
    """Roll a floor snapshot. ``vendor_names`` maps VT-* → catalog name."""
    units_by_casino: dict[str, dict] = {}
    vendor_units: dict[str, int] = {}
    cabinet_units: dict[str, int] = {}
    floor_vendors: dict[str, set[str]] = {}

    for row in machine_rows:
        cabinet = (row.get("cabinet_name") or "").strip()
        if not _is_floor_machine(cabinet):
            continue
        casino_id = str(row.get("casino_id") or "").strip()
        if not casino_id:
            continue
        name = (row.get("casino_name") or casino_id).strip()
        slot = units_by_casino.setdefault(
            casino_id,
            {
                "casino": name,
                "units": 0,
                "floor": row.get("total_number_of_machines"),
            },
        )
        slot["units"] += 1
        if slot.get("floor") in (None, "") and row.get("total_number_of_machines") not in (None, ""):
            slot["floor"] = row.get("total_number_of_machines")

        vendor_id = str(row.get("vendor_id") or "").strip()
        vendor_name = (row.get("vendor_name") or vendor_names.get(vendor_id) or "").strip()
        if not vendor_name:
            vendor_name = "Unknown"
        vendor_units[vendor_name] = vendor_units.get(vendor_name, 0) + 1
        if vendor_id:
            floor_vendors.setdefault(casino_id, set()).add(vendor_id)

        cab_label = cabinet or "Unknown"
        cabinet_units[cab_label] = cabinet_units.get(cab_label, 0) + 1

    contracted = 0
    penetrated = 0
    for row in casino_rows:
        casino_id = str(row.get("reference_key") or "").strip()
        present = floor_vendors.get(casino_id, set())
        for vendor_id in dict.fromkeys(_vendor_ids(row.get("available_vendors"))):
            if vendor_id in UNIVERSAL_VENDOR_IDS:
                continue
            if vendor_id not in vendor_names:
                continue
            contracted += 1
            if vendor_id in present:
                penetrated += 1

    floor_units = 0
    floor_size = 0
    leaders = []
    for slot in units_by_casino.values():
        try:
            house = int(slot["floor"] or 0)
        except (TypeError, ValueError):
            house = 0
        if house <= 0:
            continue
        floor_units += slot["units"]
        floor_size += house
        leaders.append(
            {
                "casino": slot["casino"],
                "units": slot["units"],
                "floor": house,
                "share_pct": _pct(slot["units"], house),
            }
        )
    leaders.sort(key=lambda r: (-r["share_pct"], -r["units"], r["casino"]))

    def _top(counts: dict[str, int], key: str) -> list[dict]:
        ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0].lower()))
        return [{key: name, "units": n} for name, n in ranked[:12]]

    units = sum(slot["units"] for slot in units_by_casino.values())
    return {
        "source": "slot_master_migration",
        "units": units,
        "casinos_with_units": len(units_by_casino),
        "contracted_markets": contracted,
        "penetrated_markets": penetrated,
        "open_markets": contracted - penetrated,
        "penetration_pct": _pct(penetrated, contracted),
        "floor_casinos": len(leaders),
        "floor_units": floor_units,
        "floor_size": floor_size,
        "blended_share_pct": _pct(floor_units, floor_size),
        "excluded_universal": list(UNIVERSAL_VENDOR_IDS.values()),
        "leaders": leaders[:12],
        "vendors": _top(vendor_units, "name"),
        "cabinets": _top(cabinet_units, "name"),
    }


@router.get("/overview")
def market_overview(
    _user: Annotated[dict | None, Depends(require_demo_user)] = None,
):
    try:
        machines = _field_query(
            """
            SELECT
                sm.casino_id,
                c.casino_name,
                c.total_number_of_machines,
                a.vendor_id,
                v.vendor_name,
                cab.cabinet_name
            FROM inventory.slot_master_migration AS sm
            INNER JOIN inventory.assets AS a ON a.reference_key = sm.asset_id
            INNER JOIN clients.casinos AS c ON c.reference_key = sm.casino_id
            LEFT JOIN vendors.vendors AS v ON v.reference_key = a.vendor_id
            LEFT JOIN vendors.cabinets AS cab ON cab.reference_key = a.cabinet_id
            WHERE sm.is_active = 1
              AND UPPER(LTRIM(RTRIM(ISNULL(sm.action, N'')))) <> N'SOLD'
            """
        )
        casinos = _field_query(
            """
            SELECT reference_key, casino_name, total_number_of_machines, available_vendors
            FROM clients.casinos
            WHERE available_vendors IS NOT NULL
              AND LEN(LTRIM(RTRIM(available_vendors))) > 0
            """
        )
        vendors = _field_query(
            """
            SELECT reference_key, vendor_name
            FROM vendors.vendors
            WHERE reference_key IS NOT NULL
            """
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    names = {
        str(row.get("reference_key") or "").strip(): str(row.get("vendor_name") or "").strip()
        for row in vendors
        if str(row.get("reference_key") or "").strip()
    }
    return build_market_snapshot(machines, casinos, names)
