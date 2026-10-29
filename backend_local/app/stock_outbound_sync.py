"""Push DGS stock_balance moves to AppSheet Inventory_Levels + eMaint (per action).

AppSheet is SSOT for location qty; eMaint INVLOC/header updated immediately for tracking.
Optimized to minimize AppSheet/eMaint round-trips (scoped Find, batched Edit/Add,
AppSheet∥eMaint).
"""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from decimal import Decimal
from typing import Any, Callable, Iterable

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
_APPSHEET_TO_SQL = {v: k for k, v in _COND_TO_APPSHEET.items()}
_LEVEL_KEY = "Level ID (Key)"
_LEVEL_KEY_ALT = "Inventory.Level ID (Key)"
_VEHICLE_CODE = re.compile(r"^V\d+$", re.IGNORECASE)


def _level_id(item: str, location: str, appsheet_cond: str) -> str:
    return f"{item}-{location}-{appsheet_cond}"


def _qty_float(v: Any) -> float:
    return float(_dec(v))


def _location_type(location: str) -> str:
    """Infer Location Type without an AppSheet round-trip when possible."""
    code = (location or "").strip()
    if not code:
        return "WH"
    if _VEHICLE_CODE.match(code):
        return "Vehicle"
    upper = code.upper()
    if upper in {"MAIN", "MAIN 2", "MAIN 3", "WAREHOUSE", "CALWH", "OVERFLOW", "PREP", "PREP02"}:
        return "WH"
    if "BENCH" in upper or upper.startswith("BNCH"):
        return "Repair"
    if "PROJECT" in upper:
        return "WH"
    return "WH"


def _appsheet_quote(value: str) -> str:
    return (value or "").replace('"', "")


def _fetch_item_levels(
    item: str,
    locations: list[str] | None = None,
) -> dict[tuple[str, str], dict[str, Any]]:
    """One AppSheet Find for Inventory_Levels of an item (optionally scoped to locations)."""
    item_s = _appsheet_quote(item)
    if not item_s:
        return {}
    locs = [
        _appsheet_quote((loc or "").strip())
        for loc in (locations or [])
        if (loc or "").strip()
    ]
    # De-dupe while preserving order.
    seen: set[str] = set()
    loc_list: list[str] = []
    for loc in locs:
        key = loc.upper()
        if not loc or key in seen:
            continue
        seen.add(key)
        loc_list.append(loc)
    if loc_list:
        if len(loc_list) == 1:
            loc_expr = f'[Location] = "{loc_list[0]}"'
        else:
            loc_expr = (
                "OR("
                + ", ".join(f'[Location] = "{loc}"' for loc in loc_list)
                + ")"
            )
        selector = (
            f'FILTER({appsheet.INVENTORY_LEVELS_TABLE}, '
            f'AND([Part ID (Ref)] = "{item_s}", {loc_expr}))'
        )
    else:
        selector = (
            f'FILTER({appsheet.INVENTORY_LEVELS_TABLE}, '
            f'[Part ID (Ref)] = "{item_s}")'
        )
    try:
        rows = appsheet.find_rows(
            appsheet.INVENTORY_LEVELS_TABLE,
            selector=selector,
            app="parts",
        )
    except appsheet.AppSheetError:
        return {}
    out: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows or []:
        loc = (row.get("Location") or "").strip()
        cond_as = (row.get("Part Condition") or "").strip()
        sql_cond = _APPSHEET_TO_SQL.get(cond_as)
        if not loc or not sql_cond:
            continue
        out[(loc, sql_cond)] = row
    return out


def upsert_appsheet_level(
    *,
    item: str,
    location: str,
    sql_condition: str,
    qty: float,
    existing: dict[str, Any] | None = None,
    levels_index: dict[tuple[str, str], dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    """Set Inventory_Levels Quantity. Returns the row used/created (for index updates)."""
    item = (item or "").strip()
    location = (location or "").strip()
    sql_condition = (sql_condition or "").strip().upper()
    appsheet_cond = _COND_TO_APPSHEET.get(sql_condition)
    if not item or not location or not appsheet_cond:
        raise ValueError(f"Cannot upsert AppSheet level for {item}/{location}/{sql_condition}")
    q = max(0.0, float(qty))
    row = existing
    if row is None and levels_index is not None:
        row = levels_index.get((location, sql_condition))
    if row:
        key = (
            (row.get(_LEVEL_KEY) or row.get(_LEVEL_KEY_ALT) or "").strip()
            or _level_id(item, location, appsheet_cond)
        )
        appsheet.edit_rows(
            appsheet.INVENTORY_LEVELS_TABLE,
            [{"Level ID (Key)": key, "Quantity": q}],
            app="parts",
        )
        row = dict(row)
        row["Quantity"] = q
        return row
    if q <= 0:
        return None
    added = appsheet.add_rows(
        appsheet.INVENTORY_LEVELS_TABLE,
        [
            {
                "Part ID (Ref)": item,
                "Location": location,
                "Location ID (Ref)": location,
                "Location Type": _location_type(location),
                "Part Condition": appsheet_cond,
                "Quantity": q,
            }
        ],
        app="parts",
    )
    return added[0] if added else {
        "Level ID (Key)": _level_id(item, location, appsheet_cond),
        "Location": location,
        "Part Condition": appsheet_cond,
        "Quantity": q,
    }


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


def set_appsheet_levels_from_balance(
    item: str,
    buckets: list[str],
    *,
    conditions: Iterable[str] | None = None,
) -> list[dict[str, Any]]:
    """Push qtys for buckets. One scoped Find, then batched Edit/Add."""
    item = (item or "").strip()
    conds = [
        (c or "").strip().upper()
        for c in (conditions or (COND_AVAILABLE, COND_DAMAGED))
        if (c or "").strip().upper() in _COND_TO_APPSHEET
    ]
    if not conds:
        conds = [COND_AVAILABLE]
    target_locs = [
        (bucket or "").strip()
        for bucket in buckets
        if (bucket or "").strip() and (bucket or "").strip().upper() != "FIELD"
    ]
    levels = _fetch_item_levels(item, target_locs)
    prior: list[dict[str, Any]] = []
    edits: list[dict[str, Any]] = []
    adds: list[dict[str, Any]] = []
    edit_meta: list[tuple[str, str, float]] = []
    add_meta: list[tuple[str, str, float, str]] = []

    for loc in target_locs:
        for sql_cond in conds:
            appsheet_cond = _COND_TO_APPSHEET[sql_cond]
            existing = levels.get((loc, sql_cond))
            before = _qty_float(existing.get("Quantity")) if existing else None
            new_qty = float(_balance_qty(item, loc, sql_cond))
            if existing is None and new_qty <= 0:
                continue
            prior.append(
                {
                    "item": item,
                    "location": loc,
                    "sql_condition": sql_cond,
                    "appsheet_condition": appsheet_cond,
                    "qty": before,
                }
            )
            if existing is not None and abs((before or 0.0) - new_qty) < 1e-9:
                continue
            if existing is not None:
                key = (
                    (existing.get(_LEVEL_KEY) or existing.get(_LEVEL_KEY_ALT) or "").strip()
                    or _level_id(item, loc, appsheet_cond)
                )
                edits.append({"Level ID (Key)": key, "Quantity": max(0.0, new_qty)})
                edit_meta.append((loc, sql_cond, max(0.0, new_qty)))
            elif new_qty > 0:
                adds.append(
                    {
                        "Part ID (Ref)": item,
                        "Location": loc,
                        "Location ID (Ref)": loc,
                        "Location Type": _location_type(loc),
                        "Part Condition": appsheet_cond,
                        "Quantity": max(0.0, new_qty),
                    }
                )
                add_meta.append((loc, sql_cond, max(0.0, new_qty), appsheet_cond))

    if edits:
        appsheet.edit_rows(appsheet.INVENTORY_LEVELS_TABLE, edits, app="parts")
        for loc, sql_cond, new_qty in edit_meta:
            row = dict(levels.get((loc, sql_cond)) or {})
            row["Quantity"] = new_qty
            levels[(loc, sql_cond)] = row
    if adds:
        added_rows = appsheet.add_rows(
            appsheet.INVENTORY_LEVELS_TABLE, adds, app="parts"
        )
        for idx, (loc, sql_cond, new_qty, appsheet_cond) in enumerate(add_meta):
            row = added_rows[idx] if idx < len(added_rows) else {
                "Level ID (Key)": _level_id(item, loc, appsheet_cond),
                "Location": loc,
                "Part Condition": appsheet_cond,
                "Quantity": new_qty,
            }
            levels[(loc, sql_cond)] = row
    return prior


def restore_appsheet_levels(prior: list[dict[str, Any]]) -> None:
    if not prior:
        return
    item = prior[0].get("item") or ""
    locs = [(snap.get("location") or "").strip() for snap in prior]
    levels = _fetch_item_levels(item, locs) if item else {}
    edits: list[dict[str, Any]] = []
    adds: list[dict[str, Any]] = []
    for snap in reversed(prior):
        qty = snap.get("qty")
        target = 0.0 if qty is None else float(qty)
        loc = snap["location"]
        sql_cond = snap["sql_condition"]
        appsheet_cond = snap.get("appsheet_condition") or _COND_TO_APPSHEET.get(sql_cond)
        if not appsheet_cond:
            continue
        existing = levels.get((loc, sql_cond))
        if existing is not None:
            key = (
                (existing.get(_LEVEL_KEY) or existing.get(_LEVEL_KEY_ALT) or "").strip()
                or _level_id(item, loc, appsheet_cond)
            )
            edits.append({"Level ID (Key)": key, "Quantity": max(0.0, target)})
        elif target > 0:
            adds.append(
                {
                    "Part ID (Ref)": item,
                    "Location": loc,
                    "Location ID (Ref)": loc,
                    "Location Type": _location_type(loc),
                    "Part Condition": appsheet_cond,
                    "Quantity": max(0.0, target),
                }
            )
    if edits:
        appsheet.edit_rows(appsheet.INVENTORY_LEVELS_TABLE, edits, app="parts")
    if adds:
        appsheet.add_rows(appsheet.INVENTORY_LEVELS_TABLE, adds, app="parts")


def _sync_one_invloc(
    *,
    item: str,
    code: str,
    loc_qty: float,
    token: str,
) -> dict[str, Any] | None:
    """Update/create one INVLOC row. Returns prior snapshot (or None if no-op create skip)."""
    found = emaint_client.find_invloc(item=item, invloc=code, token=token)
    if found and found.get("cuid"):
        snap = {
            "kind": "invloc",
            "item": item,
            "invloc": code,
            "cuid": found["cuid"],
            "onhand": _qty_float(found.get("onhand")),
            "created": False,
        }
        if abs(_qty_float(found.get("onhand")) - loc_qty) >= 1e-9:
            emaint_client.set_invloc_onhand(
                cuid=found["cuid"], onhand=loc_qty, token=token
            )
        return snap
    if loc_qty > 0:
        cuid = emaint_client.create_invloc(item=item, invloc=code, onhand=loc_qty)
        return {
            "kind": "invloc",
            "item": item,
            "invloc": code,
            "cuid": cuid,
            "onhand": None,
            "created": True,
        }
    return None


def sync_emaint_item_locations(item: str, locations: list[str]) -> list[dict[str, Any]]:
    """Set INVLOC onhand per location + ARINVT01 header. Returns prior snapshots for undo."""
    item = (item or "").strip()
    token = emaint_client.get_login_token()
    prior: list[dict[str, Any]] = []
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

    loc_totals = {
        (loc or "").strip(): location_balance_total(item, (loc or "").strip())
        for loc in locations
        if (loc or "").strip() and (loc or "").strip().upper() != "FIELD"
    }

    codes: list[str] = []
    seen: set[str] = set()
    for loc in locations:
        code = (loc or "").strip()
        if not code or code.upper() == "FIELD" or code.upper() in seen:
            continue
        seen.add(code.upper())
        codes.append(code)

    if len(codes) <= 1:
        for code in codes:
            snap = _sync_one_invloc(
                item=item, code=code, loc_qty=loc_totals.get(code, 0.0), token=token
            )
            if snap:
                prior.append(snap)
    else:
        # Add Stock touches from+to — run INVLOC updates concurrently.
        with ThreadPoolExecutor(max_workers=min(4, len(codes))) as pool:
            futures = {
                pool.submit(
                    _sync_one_invloc,
                    item=item,
                    code=code,
                    loc_qty=loc_totals.get(code, 0.0),
                    token=token,
                ): code
                for code in codes
            }
            for fut in as_completed(futures):
                snap = fut.result()
                if snap:
                    prior.append(snap)

    header_qty = item_balance_total(item)
    if header_before is None or abs(header_before - header_qty) >= 1e-9:
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


def push_stock_outbound(
    item: str,
    locations: list[str],
    *,
    conditions: Iterable[str] | None = None,
) -> Callable[[], None]:
    """After SQL move: AppSheet levels ∥ eMaint. Fail-closed undo for both."""
    item = (item or "").strip()
    locs = [((x or "").strip()) for x in locations if (x or "").strip()]
    as_prior: list[dict[str, Any]] = []
    em_prior: list[dict[str, Any]] = []
    as_err: BaseException | None = None
    em_err: BaseException | None = None

    def _do_appsheet() -> None:
        nonlocal as_prior, as_err
        try:
            as_prior = set_appsheet_levels_from_balance(
                item, locs, conditions=conditions
            )
        except BaseException as exc:  # noqa: BLE001 — surface either side
            as_err = exc

    def _do_emaint() -> None:
        nonlocal em_prior, em_err
        try:
            em_prior = sync_emaint_item_locations(item, locs)
        except BaseException as exc:  # noqa: BLE001
            em_err = exc

    with ThreadPoolExecutor(max_workers=2) as pool:
        f_as = pool.submit(_do_appsheet)
        f_em = pool.submit(_do_emaint)
        f_as.result()
        f_em.result()

    if as_err is not None:
        if em_prior:
            try:
                restore_emaint(em_prior)
            except Exception:
                pass
        raise as_err
    if em_err is not None:
        if as_prior:
            try:
                restore_appsheet_levels(as_prior)
            except Exception:
                pass
        raise em_err

    def undo() -> None:
        restore_emaint(em_prior)
        restore_appsheet_levels(as_prior)

    return undo
