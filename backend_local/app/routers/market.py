"""Market tab — leased floor penetration and a separate sales book.

Units are active ``inventory.slot_master_migration`` rows joined to an asset.
A leased unit is on the floor. A row in ``projects.sold_details`` is a sale
and does not count as penetration.
House floor size and contracted vendors come from ``clients.casinos``.
Master Revenue is not a source.
"""

from __future__ import annotations

import os

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException

from app import mssql
from app.auth_deps import require_demo_user

router = APIRouter(prefix="/api/market", tags=["market"])

# Absence of these vendors is not an open market. They stay on the agreement
# list and still count in the floor charts when a machine is actually there.
UNIVERSAL_VENDOR_IDS = {
    "VT-008": "Lightning Gaming",
    "VT-023": "Spintec",
    "VT-024": "Light & Wonder",
}

# Catch-all, not a nation. Those houses stay on the casino and vendor bands.
COMMERCIAL_TRIBE_ID = "TR-00121"

GAME_SALE = "Game Sale"
CONVERT_TO_SALE = "Convert to Sale"


def _catalog() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _field_query(sql: str, params=None):
    return mssql.query(sql, params=params, database=_catalog(), profile="field", load_env=False)


_EXCLUDED_CABINET_TYPES = {"center", "sign", "controller", "server"}


def _is_floor_machine(cabinet_type: str | None) -> bool:
    return (cabinet_type or "").strip().lower() not in _EXCLUDED_CABINET_TYPES


def _vendor_ids(raw: Any) -> list[str]:
    if raw is None:
        return []
    return [part.strip() for part in str(raw).split(",") if part.strip()]


def _pct(part: float, whole: float) -> float:
    if whole <= 0:
        return 0.0
    return round(100.0 * part / whole, 1)


def _floor_int(raw: Any) -> int:
    try:
        return int(raw or 0)
    except (TypeError, ValueError):
        return 0


def _band(contracted: int, penetrated: int) -> dict:
    return {
        "contracted": contracted,
        "penetrated": penetrated,
        "open": contracted - penetrated,
        "penetration_pct": _pct(penetrated, contracted),
    }


def _touch_casino(
    store: dict[str, dict],
    casino_id: str,
    name: str,
    tribe_id: str,
    tribe_name: str,
    floor: Any,
) -> dict:
    slot = store.get(casino_id)
    if slot is None:
        slot = {
            "casino_id": casino_id,
            "casino": name or casino_id,
            "tribe_id": tribe_id,
            "tribe_name": tribe_name,
            "units": 0,
            "floor": floor,
            "vendors_present": set(),
            "contracted_vendors": [],
        }
        store[casino_id] = slot
        return slot
    if name and slot["casino"] in ("", casino_id):
        slot["casino"] = name
    if tribe_id and not slot["tribe_id"]:
        slot["tribe_id"] = tribe_id
        slot["tribe_name"] = tribe_name or slot["tribe_name"]
    elif tribe_name and not slot["tribe_name"]:
        slot["tribe_name"] = tribe_name
    if slot.get("floor") in (None, "") and floor not in (None, ""):
        slot["floor"] = floor
    return slot


def build_market_snapshot(
    machine_rows: list[dict],
    casino_rows: list[dict],
    vendor_names: dict[str, str],
) -> dict:
    """Roll a floor snapshot. ``vendor_names`` maps VT-* → catalog name.

    Penetration is leased floor units only. Sales are not an input.
    """
    casinos: dict[str, dict] = {}
    vendor_units: dict[str, int] = {}
    cabinet_units: dict[str, int] = {}

    for row in machine_rows:
        cabinet = (row.get("cabinet_name") or "").strip()
        if not _is_floor_machine(row.get("cabinet_type")):
            continue
        casino_id = str(row.get("casino_id") or "").strip()
        if not casino_id:
            continue
        slot = _touch_casino(
            casinos,
            casino_id,
            (row.get("casino_name") or casino_id).strip(),
            str(row.get("tribe_id") or "").strip(),
            (row.get("tribe_name") or "").strip(),
            row.get("total_number_of_machines"),
        )
        slot["units"] += 1
        vendor_id = str(row.get("vendor_id") or "").strip()
        vendor_name = (row.get("vendor_name") or vendor_names.get(vendor_id) or "").strip()
        if not vendor_name:
            vendor_name = "Unknown"
        vendor_units[vendor_name] = vendor_units.get(vendor_name, 0) + 1
        if vendor_id:
            slot["vendors_present"].add(vendor_id)
        cab_label = cabinet or "Unknown"
        cabinet_units[cab_label] = cabinet_units.get(cab_label, 0) + 1

    pair_contracted = 0
    pair_penetrated = 0
    for row in casino_rows:
        casino_id = str(row.get("reference_key") or "").strip()
        if not casino_id:
            continue
        slot = _touch_casino(
            casinos,
            casino_id,
            (row.get("casino_name") or casino_id).strip(),
            str(row.get("tribe_id") or "").strip(),
            (row.get("tribe_name") or "").strip(),
            row.get("total_number_of_machines"),
        )
        contracted: list[str] = []
        for vendor_id in dict.fromkeys(_vendor_ids(row.get("available_vendors"))):
            if vendor_id in UNIVERSAL_VENDOR_IDS:
                continue
            if vendor_id not in vendor_names:
                continue
            contracted.append(vendor_id)
        slot["contracted_vendors"] = contracted
        pair_contracted += len(contracted)
        pair_penetrated += sum(1 for vendor_id in contracted if vendor_id in slot["vendors_present"])

    contracted_houses = [slot for slot in casinos.values() if slot["contracted_vendors"]]
    houses_on_floor = sum(1 for slot in contracted_houses if slot["units"] > 0)
    commercial_houses = sum(
        1 for slot in contracted_houses if slot["tribe_id"] == COMMERCIAL_TRIBE_ID
    )
    unlisted_casinos = sum(
        1 for slot in casinos.values() if slot["units"] > 0 and not slot["contracted_vendors"]
    )

    tribes: dict[str, dict] = {}
    for slot in casinos.values():
        tribe_id = slot["tribe_id"]
        if not tribe_id or tribe_id == COMMERCIAL_TRIBE_ID:
            continue
        tribe = tribes.setdefault(
            tribe_id,
            {
                "tribe_id": tribe_id,
                "name": slot["tribe_name"] or tribe_id,
                "contracted_casinos": 0,
                "open_casinos": 0,
                "on_floor": 0,
                "units": 0,
                "floor_units": 0,
                "floor_size": 0,
            },
        )
        if slot["tribe_name"]:
            tribe["name"] = slot["tribe_name"]
        if slot["contracted_vendors"]:
            tribe["contracted_casinos"] += 1
            if slot["units"] <= 0:
                tribe["open_casinos"] += 1
        if slot["units"] > 0:
            tribe["on_floor"] += 1
            tribe["units"] += slot["units"]
            house = _floor_int(slot["floor"])
            if house > 0:
                tribe["floor_units"] += slot["units"]
                tribe["floor_size"] += house

    tribe_rows = [tribe for tribe in tribes.values() if tribe["contracted_casinos"] > 0]
    for tribe in tribe_rows:
        tribe["share_pct"] = _pct(tribe["floor_units"], tribe["floor_size"])
    tribe_rows.sort(key=lambda tribe: (-tribe["open_casinos"], tribe["name"].lower()))
    tribe_penetrated = sum(1 for tribe in tribe_rows if tribe["on_floor"] > 0)

    floor_units = 0
    floor_size = 0
    leaders = []
    for slot in casinos.values():
        if slot["units"] <= 0:
            continue
        house = _floor_int(slot["floor"])
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
    leaders.sort(key=lambda row: (-row["share_pct"], -row["units"], row["casino"]))

    def _top(counts: dict[str, int], key: str) -> list[dict]:
        ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0].lower()))
        return [{key: name, "units": n} for name, n in ranked[:12]]

    units = sum(slot["units"] for slot in casinos.values())
    vendor_band = _band(pair_contracted, pair_penetrated)
    return {
        "source": "slot_master_migration",
        "units": units,
        "casinos_with_units": sum(1 for slot in casinos.values() if slot["units"] > 0),
        "contracted_markets": vendor_band["contracted"],
        "penetrated_markets": vendor_band["penetrated"],
        "open_markets": vendor_band["open"],
        "penetration_pct": vendor_band["penetration_pct"],
        "floor_casinos": len(leaders),
        "floor_units": floor_units,
        "floor_size": floor_size,
        "blended_share_pct": _pct(floor_units, floor_size),
        "excluded_universal": list(UNIVERSAL_VENDOR_IDS.values()),
        "commercial_houses": commercial_houses,
        "unlisted_casinos": unlisted_casinos,
        "bands": {
            "tribe": _band(len(tribe_rows), tribe_penetrated),
            "casino": _band(len(contracted_houses), houses_on_floor),
            "vendor_casino": vendor_band,
        },
        "tribes": tribe_rows,
        "leaders": leaders[:12],
        "vendors": _top(vendor_units, "name"),
        "cabinets": _top(cabinet_units, "name"),
    }


def build_sales_summary(rows: list[dict]) -> dict:
    """Count sold_details. A sale is not penetration."""
    game = convert = other = reseller = 0
    game_houses: set[str] = set()
    convert_houses: set[str] = set()
    for row in rows:
        reason = str(row.get("sale_reason") or "").strip()
        buyer_type = str(row.get("buyer_type") or "").strip().upper()
        buyer = str(row.get("buyer_reference") or "").strip()
        house = buyer if buyer_type == "CASINO" and buyer.upper().startswith("CT-") else ""
        if reason == GAME_SALE:
            game += 1
            if house:
                game_houses.add(house)
            elif buyer_type == "RESELLER":
                reseller += 1
        elif reason == CONVERT_TO_SALE:
            convert += 1
            if house:
                convert_houses.add(house)
        else:
            other += 1
    return {
        "units": game + convert + other,
        "game_sale": game,
        "convert_to_sale": convert,
        "other": other,
        "game_sale_houses": len(game_houses),
        "convert_houses": len(convert_houses),
        "reseller_units": reseller,
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
                c.tribe_id,
                tr.tribe_name,
                c.total_number_of_machines,
                a.vendor_id,
                v.vendor_name,
                a.cabinet_type,
                cab.cabinet_name
            FROM inventory.slot_master_migration AS sm
            INNER JOIN inventory.assets AS a ON a.reference_key = sm.asset_id
            INNER JOIN clients.casinos AS c ON c.reference_key = sm.casino_id
            LEFT JOIN clients.tribes AS tr ON tr.reference_key = c.tribe_id
            LEFT JOIN vendors.vendors AS v ON v.reference_key = a.vendor_id
            LEFT JOIN vendors.cabinets AS cab ON cab.reference_key = a.cabinet_id
            WHERE sm.is_active = 1
              AND UPPER(LTRIM(RTRIM(ISNULL(sm.action, N'')))) <> N'SOLD'
            """
        )
        casinos = _field_query(
            """
            SELECT
                c.reference_key,
                c.casino_name,
                c.tribe_id,
                tr.tribe_name,
                c.total_number_of_machines,
                c.available_vendors
            FROM clients.casinos AS c
            LEFT JOIN clients.tribes AS tr ON tr.reference_key = c.tribe_id
            WHERE c.available_vendors IS NOT NULL
              AND LEN(LTRIM(RTRIM(c.available_vendors))) > 0
            """
        )
        vendors = _field_query(
            """
            SELECT reference_key, vendor_name
            FROM vendors.vendors
            WHERE reference_key IS NOT NULL
            """
        )
        sales = _field_query(
            """
            SELECT sale_reason, buyer_type, buyer_reference
            FROM projects.sold_details
            """
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    names = {
        str(row.get("reference_key") or "").strip(): str(row.get("vendor_name") or "").strip()
        for row in vendors
        if str(row.get("reference_key") or "").strip()
    }
    snapshot = build_market_snapshot(machines, casinos, names)
    snapshot["sales"] = build_sales_summary(sales)
    return snapshot
