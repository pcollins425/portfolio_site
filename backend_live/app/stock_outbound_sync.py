"""Push DGS stock_balance moves to AppSheet Inventory_Levels + eMaint (per action).

AppSheet is SSOT for location qty; eMaint INVLOC/header updated immediately for tracking.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Any, Callable

from app import appsheet_client as appsheet
from app import emaint_client
from app import emaint_demo_service as demo
from app.wo_inventory_service import (
    COND_AVAILABLE,
    COND_DAMAGED,
    _balance_qty,
    _dec,
)

# SQL condition → AppSheet Part Condition
_COND_TO_APPSHEET = {
    COND_AVAILABLE: "Usable",
    COND_DAMAGED: "Defective",
}
_APPSHEET_CONDS = tuple(_COND_TO_APPSHEET.values())
_LEVEL_KEY = "Level ID (Key)"
_LEVEL_KEY_ALT = "Inventory.Level ID (Key)"


def _level_id(item: str, location: str, appsheet_cond: str) -> str:
    return f"{item}-{location}-{appsheet_cond}"


def _qty_float(v: Any) -> float:
    return float(_dec(v))


def _find_level_row(item: str, location: str, appsheet_cond: str) -> dict[str, Any] | None:
    lid = _level_id(item, location, appsheet_cond)
    safe = lid.replace('"', "")
    item_s = item.replace('"', "")
    loc_s = location.replace('"', "")
    cond_s = appsheet_cond.replace('"', "")
    rows: list[dict[str, Any]] = []
    try:
        rows = appsheet.find_rows(
            appsheet.INVENTORY_LEVELS_TABLE,
            selector=(
                f'FILTER({appsheet.INVENTORY_LEVELS_TABLE}, '
                f'[Level ID (Key)] = "{safe}")'
            ),
            app="parts",
        )
    except appsheet.AppSheetError:
        rows = []
    if not rows:
        try:
            rows = appsheet.find_rows(
                appsheet.INVENTORY_LEVELS_TABLE,
                selector=(
                    f'FILTER({appsheet.INVENTORY_LEVELS_TABLE}, AND('
                    f'[Part ID (Ref)] = "{item_s}", '
                    f'[Location] = "{loc_s}", '
                    f'[Part Condition] = "{cond_s}"))'
                ),
                app="parts",
            )
        except appsheet.AppSheetError:
            rows = []
    return rows[0] if rows else None


def _location_type(location: str) -> str:
    """Best-effort Type from Locations (Tech app shares Locations table)."""
    code = (location or "").strip()
    if not code:
        return "WH"
    if code.upper().startswith("V") and code[1:].isdigit():
        return "Vehicle"
    safe = code.replace('"', "")
    try:
        rows = appsheet.find_rows(
            appsheet.LOCATIONS_TABLE,
            selector=(
                f'TOP(FILTER({appsheet.LOCATIONS_TABLE}, '
                f'OR([Location ID (Key)] = "{safe}", '
                f'[Location ID (Key)NameType] = "{safe}", '
                f'[Warehouse] = "{safe}")), 3)'
            ),
            app="tech",
        )
    except appsheet.AppSheetError:
        return "WH"
    for row in rows or []:
        t = (row.get("Type") or "").strip()
        if t:
            return t
    return "WH"


def read_appsheet_level_qty(item: str, location: str, sql_condition: str) -> float | None:
    """Current AppSheet qty, or None if no level row."""
    appsheet_cond = _COND_TO_APPSHEET.get((sql_condition or "").strip().upper())
    if not appsheet_cond:
        return None
    row = _find_level_row(item, location, appsheet_cond)
    if not row:
        return None
    return _qty_float(row.get("Quantity"))


def upsert_appsheet_level(
    *,
    item: str,
    location: str,
    sql_condition: str,
    qty: float,
) -> None:
    """Set Inventory_Levels Quantity for item/location/condition (create if needed)."""
    item = (item or "").strip()
    location = (location or "").strip()
    sql_condition = (sql_condition or "").strip().upper()
    appsheet_cond = _COND_TO_APPSHEET.get(sql_condition)
    if not item or not location or not appsheet_cond:
        raise ValueError(f"Cannot upsert AppSheet level for {item}/{location}/{sql_condition}")
    q = max(0.0, float(qty))
    existing = _find_level_row(item, location, appsheet_cond)
    if existing:
        key = (
            (existing.get(_LEVEL_KEY) or existing.get(_LEVEL_KEY_ALT) or "").strip()
            or _level_id(item, location, appsheet_cond)
        )
        appsheet.edit_rows(
            appsheet.INVENTORY_LEVELS_TABLE,
            [{"Level ID (Key)": key, "Quantity": q}],
            app="parts",
        )
        return
    if q <= 0:
        return
    loc_type = _location_type(location)
    appsheet.add_rows(
        appsheet.INVENTORY_LEVELS_TABLE,
        [
            {
                "Part ID (Ref)": item,
                "Location": location,
                "Location ID (Ref)": location,
                "Location Type": loc_type,
                "Part Condition": appsheet_cond,
                "Quantity": q,
            }
        ],
        app="parts",
    )


def item_balance_total(item: str) -> float:
    rows = demo._query(
        "SELECT qty FROM [inventory].[stock_balance] WHERE [item] = %s AND [qty] > 0",
        ((item or "").strip(),),
    )
    total = Decimal("0")
    for r in rows or []:
        total += _dec(r.get("qty"))
    return float(max(Decimal("0"), total))


def location_balance_total(item: str, location: str) -> float:
    rows = demo._query(
        "SELECT qty FROM [inventory].[stock_balance] "
        "WHERE [item] = %s AND [bucket] = %s AND [qty] > 0",
        ((item or "").strip(), (location or "").strip()),
    )
    total = Decimal("0")
    for r in rows or []:
        total += _dec(r.get("qty"))
    return float(max(Decimal("0"), total))


def set_appsheet_levels_from_balance(item: str, buckets: list[str]) -> list[dict[str, Any]]:
    """Push AVAILABLE/DAMAGED qtys for buckets. Returns prior AppSheet snapshots for undo."""
    item = (item or "").strip()
    prior: list[dict[str, Any]] = []
    for bucket in buckets:
        loc = (bucket or "").strip()
        if not loc or loc.upper() == "FIELD":
            continue
        for sql_cond, appsheet_cond in _COND_TO_APPSHEET.items():
            before = read_appsheet_level_qty(item, loc, sql_cond)
            prior.append(
                {
                    "item": item,
                    "location": loc,
                    "sql_condition": sql_cond,
                    "appsheet_condition": appsheet_cond,
                    "qty": before,
                }
            )
            new_qty = float(_balance_qty(item, loc, sql_cond))
            upsert_appsheet_level(
                item=item, location=loc, sql_condition=sql_cond, qty=new_qty
            )
    return prior


def restore_appsheet_levels(prior: list[dict[str, Any]]) -> None:
    for snap in reversed(prior or []):
        qty = snap.get("qty")
        if qty is None:
            # Row did not exist — set to 0 (leave empty row) rather than delete.
            upsert_appsheet_level(
                item=snap["item"],
                location=snap["location"],
                sql_condition=snap["sql_condition"],
                qty=0.0,
            )
        else:
            upsert_appsheet_level(
                item=snap["item"],
                location=snap["location"],
                sql_condition=snap["sql_condition"],
                qty=float(qty),
            )


def sync_emaint_item_locations(item: str, locations: list[str]) -> list[dict[str, Any]]:
    """Set INVLOC onhand per location + ARINVT01 header. Returns prior snapshots for undo."""
    item = (item or "").strip()
    token = emaint_client.get_login_token()
    prior: list[dict[str, Any]] = []
    # Header before
    header_rows = emaint_client.get_any_data(
        table="ARINVT01",
        columns="item,onhand",
        filters=[{"field": "item", "operator": "eq", "value": item}],
        page_size=1,
        token=token,
    )
    header_before = None
    if header_rows:
        header_before = _qty_float(header_rows[0].get("onhand"))
    prior.append({"kind": "header", "item": item, "onhand": header_before})

    seen: set[str] = set()
    for loc in locations:
        code = (loc or "").strip()
        if not code or code.upper() == "FIELD" or code.upper() in seen:
            continue
        seen.add(code.upper())
        found = emaint_client.find_invloc(item=item, invloc=code, token=token)
        loc_qty = location_balance_total(item, code)
        if found and found.get("cuid"):
            prior.append(
                {
                    "kind": "invloc",
                    "item": item,
                    "invloc": code,
                    "cuid": found["cuid"],
                    "onhand": _qty_float(found.get("onhand")),
                    "created": False,
                }
            )
            emaint_client.set_invloc_onhand(
                cuid=found["cuid"], onhand=loc_qty, token=token
            )
        elif loc_qty > 0:
            # Zero qty does not need a new INVLOC row; create only when stock lands.
            cuid = emaint_client.create_invloc(item=item, invloc=code, onhand=loc_qty)
            prior.append(
                {
                    "kind": "invloc",
                    "item": item,
                    "invloc": code,
                    "cuid": cuid,
                    "onhand": None,
                    "created": True,
                }
            )

    header_qty = item_balance_total(item)
    emaint_client.set_arinvt01_onhand(item=item, onhand=header_qty, token=token)
    return prior


def restore_emaint(prior: list[dict[str, Any]]) -> None:
    token = emaint_client.get_login_token()
    for snap in reversed(prior or []):
        kind = snap.get("kind")
        try:
            if kind == "invloc" and snap.get("cuid"):
                if snap.get("created"):
                    emaint_client.set_invloc_onhand(
                        cuid=snap["cuid"], onhand=0.0, token=token
                    )
                elif snap.get("onhand") is not None:
                    emaint_client.set_invloc_onhand(
                        cuid=snap["cuid"],
                        onhand=float(snap["onhand"]),
                        token=token,
                    )
            elif kind == "header" and snap.get("onhand") is not None:
                emaint_client.set_arinvt01_onhand(
                    item=snap["item"], onhand=float(snap["onhand"]), token=token
                )
        except Exception:
            pass


def push_stock_outbound(item: str, locations: list[str]) -> Callable[[], None]:
    """After SQL move: AppSheet levels then eMaint. Returns undo for both."""
    item = (item or "").strip()
    locs = [((x or "").strip()) for x in locations if (x or "").strip()]
    as_prior = set_appsheet_levels_from_balance(item, locs)
    try:
        em_prior = sync_emaint_item_locations(item, locs)
    except Exception:
        restore_appsheet_levels(as_prior)
        raise

    def undo() -> None:
        restore_emaint(em_prior)
        restore_appsheet_levels(as_prior)

    return undo
