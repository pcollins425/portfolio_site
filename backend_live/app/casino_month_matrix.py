"""Casino × month TDW/ADW matrix, and the sign-grouped units behind one cell.

The browser receives the grid. A cell click loads that casino-month only.
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any, Callable

Query = Callable[..., list[dict[str, Any]]]

_MV = "[dashboard].[vw_performance_report]"

_UNIT_FILTER = """
  AND NOT (
        (mr.TDW IS NULL OR mr.TDW = 0)
    AND (mr.ADW IS NULL OR mr.ADW = 0)
  )
"""

_CASINO_JOINS = """
LEFT JOIN inventory.slot_master_migration smm
  ON smm.reference_key = mr.slot_master_id
LEFT JOIN clients.casinos c
  ON c.reference_key = smm.casino_id
LEFT JOIN clients.casinos c2
  ON c.reference_key IS NULL AND c2.casino_short = RTRIM(mr.Casino)
"""

_CASINO_ID = (
    "COALESCE(c.reference_key, c2.reference_key, N'label:' + RTRIM(mr.Casino))"
)
_CASINO_NAME = (
    "COALESCE(c.casino_name, c2.casino_name, RTRIM(mr.Casino))"
)


def month_keys(end: date, n: int = 6) -> list[str]:
    """YYYY-MM keys ending on ``end``, oldest first."""
    year, month = end.year, end.month
    keys: list[str] = []
    for _ in range(n):
        keys.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            year -= 1
            month = 12
    keys.reverse()
    return keys


def _bounds(keys: list[str]) -> tuple[date, date]:
    year, month = int(keys[0][:4]), int(keys[0][5:7])
    start = date(year, month, 1)
    year2, month2 = int(keys[-1][:4]), int(keys[-1][5:7])
    if month2 == 12:
        end = date(year2 + 1, 1, 1)
    else:
        end = date(year2, month2 + 1, 1)
    return start, end


def _avg(total: float, n: int) -> float | None:
    if not n:
        return None
    return round(total / n, 2)


def build_matrix(query: Query, end: date) -> dict[str, Any]:
    keys = month_keys(end, 6)
    start, stop = _bounds(keys)
    rows = query(
        f"""
SELECT
  {_CASINO_ID} AS casino_id,
  {_CASINO_NAME} AS casino_name,
  CONVERT(char(7), TRY_CONVERT(date, mr.[date]), 126) AS ym,
  SUM(CASE WHEN mr.TDW IS NOT NULL THEN CAST(mr.TDW AS float) ELSE 0 END) AS tdw_sum,
  SUM(CASE WHEN mr.TDW IS NOT NULL THEN 1 ELSE 0 END) AS tdw_n,
  SUM(CASE WHEN mr.ADW IS NOT NULL THEN CAST(mr.ADW AS float) ELSE 0 END) AS adw_sum,
  SUM(CASE WHEN mr.ADW IS NOT NULL THEN 1 ELSE 0 END) AS adw_n
FROM {_MV} AS mr
{_CASINO_JOINS}
WHERE TRY_CONVERT(date, mr.[date]) >= %s
  AND TRY_CONVERT(date, mr.[date]) < %s
{_UNIT_FILTER}
GROUP BY
  {_CASINO_ID},
  {_CASINO_NAME},
  CONVERT(char(7), TRY_CONVERT(date, mr.[date]), 126)
""",
        (start, stop),
    )

    houses: dict[str, dict[str, Any]] = {}
    floor = {
        ym: {"tdw_sum": 0.0, "tdw_n": 0, "adw_sum": 0.0, "adw_n": 0} for ym in keys
    }
    for row in rows:
        ym = str(row["ym"] or "").strip()
        if ym not in floor:
            continue
        cid = str(row["casino_id"] or "").strip()
        house = houses.setdefault(
            cid,
            {
                "casino_id": cid,
                "casino_name": str(row["casino_name"] or "").strip(),
                "tdw": {},
                "adw": {},
                "_tdw_sum": 0.0,
                "_tdw_n": 0,
                "_adw_sum": 0.0,
                "_adw_n": 0,
            },
        )
        tdw_n = int(row["tdw_n"] or 0)
        adw_n = int(row["adw_n"] or 0)
        tdw_sum = float(row["tdw_sum"] or 0)
        adw_sum = float(row["adw_sum"] or 0)
        if tdw_n:
            house["tdw"][ym] = _avg(tdw_sum, tdw_n)
            house["_tdw_sum"] += tdw_sum
            house["_tdw_n"] += tdw_n
            floor[ym]["tdw_sum"] += tdw_sum
            floor[ym]["tdw_n"] += tdw_n
        if adw_n:
            house["adw"][ym] = _avg(adw_sum, adw_n)
            house["_adw_sum"] += adw_sum
            house["_adw_n"] += adw_n
            floor[ym]["adw_sum"] += adw_sum
            floor[ym]["adw_n"] += adw_n

    casinos = []
    for house in houses.values():
        casinos.append(
            {
                "casino_id": house["casino_id"],
                "casino_name": house["casino_name"],
                "tdw": house["tdw"],
                "adw": house["adw"],
                "tdw_avg": _avg(house["_tdw_sum"], house["_tdw_n"]),
                "adw_avg": _avg(house["_adw_sum"], house["_adw_n"]),
            }
        )
    casinos.sort(key=lambda r: r["casino_name"].lower())
    return {
        "source": "live",
        "performance_month": keys[-1],
        "months": keys,
        "casinos": casinos,
        "floor": {
            "tdw": {ym: _avg(v["tdw_sum"], v["tdw_n"]) for ym, v in floor.items()},
            "adw": {ym: _avg(v["adw_sum"], v["adw_n"]) for ym, v in floor.items()},
        },
    }


def _sign_index(query: Query) -> dict[str, dict[str, str]]:
    """Map a cabinet SMM key to the SSM line that lists it."""
    rows = query(
        """
SELECT reference_key AS ssm,
       sign_serial,
       asset_smm_list
FROM dashboard.vw_sign_slot_match
"""
    )
    index: dict[str, dict[str, str]] = {}
    for row in rows:
        raw = row.get("asset_smm_list") or "[]"
        try:
            keys = json.loads(raw) if isinstance(raw, str) else list(raw)
        except json.JSONDecodeError:
            continue
        ssm = str(row["ssm"] or "")
        sign_serial = str(row["sign_serial"] or "").strip()
        for key in keys:
            smm = str(key or "").strip()
            if not smm:
                continue
            current = index.get(smm)
            if current is None or ssm > current["ssm"]:
                index[smm] = {"ssm": ssm, "sign_serial": sign_serial}
    return index


def _serial_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "serial": str(row["serial"] or "").strip() or "(no serial)",
        "tdw": None if row["tdw"] is None else round(float(row["tdw"]), 2),
        "adw": None if row["adw"] is None else round(float(row["adw"]), 2),
        "days": None if row["days"] is None else int(row["days"]),
        "slot_master_id": str(row["slot_master_id"] or "").strip() or None,
    }


def build_cell(query: Query, casino_id: str, ym: str) -> dict[str, Any]:
    year, month = int(ym[:4]), int(ym[5:7])
    start = date(year, month, 1)
    stop = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    rows = query(
        f"""
SELECT
  {_CASINO_NAME} AS casino_name,
  RTRIM(mr.Serial_number) AS serial,
  RTRIM(mr.Vendor) AS vendor,
  RTRIM(mr.Cabinet) AS cabinet,
  RTRIM(mr.Theme) AS theme,
  CAST(mr.TDW AS float) AS tdw,
  CAST(mr.ADW AS float) AS adw,
  mr.Days_on_Floor AS days,
  mr.slot_master_id
FROM {_MV} AS mr
{_CASINO_JOINS}
WHERE TRY_CONVERT(date, mr.[date]) >= %s
  AND TRY_CONVERT(date, mr.[date]) < %s
  AND {_CASINO_ID} = %s
{_UNIT_FILTER}
""",
        (start, stop, casino_id),
    )
    signs = _sign_index(query)
    casino_name = str(rows[0]["casino_name"]).strip() if rows else ""

    # vendor -> cabinet -> sign ssm -> theme -> serials, plus unsigned themes
    tree: dict[str, dict[str, dict[str, Any]]] = {}
    for row in rows:
        vendor = str(row["vendor"] or "").strip() or "—"
        cabinet = str(row["cabinet"] or "").strip() or "—"
        theme = str(row["theme"] or "").strip() or "—"
        slot = tree.setdefault(vendor, {}).setdefault(
            cabinet, {"signs": {}, "themes": {}}
        )
        serial = _serial_row(row)
        smm = serial["slot_master_id"]
        sign = signs.get(smm or "")
        if sign:
            group = slot["signs"].setdefault(
                sign["ssm"],
                {
                    "ssm": sign["ssm"],
                    "sign_serial": sign["sign_serial"],
                    "themes": {},
                },
            )
            group["themes"].setdefault(theme, []).append(serial)
        else:
            slot["themes"].setdefault(theme, []).append(serial)

    def theme_nodes(themes: dict[str, list]) -> list[dict[str, Any]]:
        out = []
        for name in sorted(themes, key=str.lower):
            serials = sorted(themes[name], key=lambda s: s["serial"])
            out.append({"theme": name, "serials": serials})
        return out

    vendors = []
    for vendor in sorted(tree, key=str.lower):
        cabinets = []
        for cabinet in sorted(tree[vendor], key=str.lower):
            node = tree[vendor][cabinet]
            sign_groups = []
            for ssm in sorted(node["signs"]):
                group = node["signs"][ssm]
                sign_groups.append(
                    {
                        "ssm": group["ssm"],
                        "sign_serial": group["sign_serial"],
                        "themes": theme_nodes(group["themes"]),
                    }
                )
            cabinets.append(
                {
                    "cabinet": cabinet,
                    "sign_groups": sign_groups,
                    "themes": theme_nodes(node["themes"]),
                }
            )
        vendors.append({"vendor": vendor, "cabinets": cabinets})

    return {
        "source": "live",
        "casino_id": casino_id,
        "casino_name": casino_name,
        "month": ym,
        "units": len(rows),
        "vendors": vendors,
    }
