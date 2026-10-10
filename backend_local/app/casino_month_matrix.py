"""Casino × month TDW/ADW matrix, and the sign-grouped units behind one cell.

The browser receives the grid. A cell click loads that casino-month only.
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any, Callable

Query = Callable[..., list[dict[str, Any]]]

_MV = "[dashboard].[vw_performance_report]"
_YM = "CONVERT(char(7), mr.[date], 126)"
_DATE_RANGE = "mr.[date] >= %s AND mr.[date] < %s"

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
  {_YM} AS ym,
  SUM(CASE WHEN mr.TDW IS NOT NULL THEN CAST(mr.TDW AS float) ELSE 0 END) AS tdw_sum,
  SUM(CASE WHEN mr.TDW IS NOT NULL THEN 1 ELSE 0 END) AS tdw_n,
  SUM(CASE WHEN mr.ADW IS NOT NULL THEN CAST(mr.ADW AS float) ELSE 0 END) AS adw_sum,
  SUM(CASE WHEN mr.ADW IS NOT NULL THEN 1 ELSE 0 END) AS adw_n,
  SUM(CASE WHEN mr.WIN_Index IS NOT NULL AND TRY_CONVERT(float, mr.HouseWPU) > 0
           THEN CAST(mr.WIN_Index AS float) ELSE 0 END) AS theo_sum,
  SUM(CASE WHEN mr.WIN_Index IS NOT NULL AND TRY_CONVERT(float, mr.HouseWPU) > 0
           THEN 1 ELSE 0 END) AS theo_n,
  SUM(CASE WHEN mr.actual_index IS NOT NULL AND TRY_CONVERT(float, mr.HouseWPU) > 0
           THEN CAST(mr.actual_index AS float) ELSE 0 END) AS actual_sum,
  SUM(CASE WHEN mr.actual_index IS NOT NULL AND TRY_CONVERT(float, mr.HouseWPU) > 0
           THEN 1 ELSE 0 END) AS actual_n
FROM {_MV} AS mr
{_CASINO_JOINS}
WHERE {_DATE_RANGE}
{_UNIT_FILTER}
GROUP BY
  {_CASINO_ID},
  {_CASINO_NAME},
  {_YM}
""",
        (start, stop),
    )

    houses: dict[str, dict[str, Any]] = {}
    floor = {
        ym: {
            "tdw_sum": 0.0,
            "tdw_n": 0,
            "adw_sum": 0.0,
            "adw_n": 0,
            "theo_sum": 0.0,
            "theo_n": 0,
            "actual_sum": 0.0,
            "actual_n": 0,
        }
        for ym in keys
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
                "theo": {},
                "actual": {},
                "_tdw_sum": 0.0,
                "_tdw_n": 0,
                "_adw_sum": 0.0,
                "_adw_n": 0,
                "_theo_sum": 0.0,
                "_theo_n": 0,
                "_actual_sum": 0.0,
                "_actual_n": 0,
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
        theo_n = int(row["theo_n"] or 0)
        actual_n = int(row["actual_n"] or 0)
        theo_sum = float(row["theo_sum"] or 0)
        actual_sum = float(row["actual_sum"] or 0)
        if theo_n:
            house["theo"][ym] = _avg(theo_sum, theo_n)
            house["_theo_sum"] += theo_sum
            house["_theo_n"] += theo_n
            floor[ym]["theo_sum"] += theo_sum
            floor[ym]["theo_n"] += theo_n
        if actual_n:
            house["actual"][ym] = _avg(actual_sum, actual_n)
            house["_actual_sum"] += actual_sum
            house["_actual_n"] += actual_n
            floor[ym]["actual_sum"] += actual_sum
            floor[ym]["actual_n"] += actual_n

    casinos = []
    for house in houses.values():
        casinos.append(
            {
                "casino_id": house["casino_id"],
                "casino_name": house["casino_name"],
                "tdw": house["tdw"],
                "adw": house["adw"],
                "theo": house["theo"],
                "actual": house["actual"],
                "tdw_avg": _avg(house["_tdw_sum"], house["_tdw_n"]),
                "adw_avg": _avg(house["_adw_sum"], house["_adw_n"]),
                "theo_avg": _avg(house["_theo_sum"], house["_theo_n"]),
                "actual_avg": _avg(house["_actual_sum"], house["_actual_n"]),
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
            "theo": {ym: _avg(v["theo_sum"], v["theo_n"]) for ym, v in floor.items()},
            "actual": {ym: _avg(v["actual_sum"], v["actual_n"]) for ym, v in floor.items()},
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
WHERE {_DATE_RANGE}
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


def _bucket() -> dict[str, dict[str, float]]:
    return {
        "tdw_sum": {},
        "tdw_n": {},
        "adw_sum": {},
        "adw_n": {},
        "theo_sum": {},
        "theo_n": {},
        "actual_sum": {},
        "actual_n": {},
    }


def _add_month(
    bucket: dict[str, dict[str, float]],
    ym: str,
    tdw: Any,
    adw: Any,
    theo: Any = None,
    actual: Any = None,
) -> None:
    if tdw is not None:
        bucket["tdw_sum"][ym] = bucket["tdw_sum"].get(ym, 0.0) + float(tdw)
        bucket["tdw_n"][ym] = bucket["tdw_n"].get(ym, 0.0) + 1
    if adw is not None:
        bucket["adw_sum"][ym] = bucket["adw_sum"].get(ym, 0.0) + float(adw)
        bucket["adw_n"][ym] = bucket["adw_n"].get(ym, 0.0) + 1
    if theo is not None:
        bucket["theo_sum"][ym] = bucket["theo_sum"].get(ym, 0.0) + float(theo)
        bucket["theo_n"][ym] = bucket["theo_n"].get(ym, 0.0) + 1
    if actual is not None:
        bucket["actual_sum"][ym] = bucket["actual_sum"].get(ym, 0.0) + float(actual)
        bucket["actual_n"][ym] = bucket["actual_n"].get(ym, 0.0) + 1


def _measures(bucket: dict[str, dict[str, float]], months: list[str]) -> dict[str, Any]:
    tdw: dict[str, float] = {}
    adw: dict[str, float] = {}
    theo: dict[str, float] = {}
    actual: dict[str, float] = {}
    tdw_sum = tdw_n = adw_sum = adw_n = 0.0
    theo_sum = theo_n = actual_sum = actual_n = 0.0
    for ym in months:
        n = bucket["tdw_n"].get(ym, 0)
        if n:
            tdw[ym] = round(bucket["tdw_sum"][ym] / n, 2)
            tdw_sum += bucket["tdw_sum"][ym]
            tdw_n += n
        n = bucket["adw_n"].get(ym, 0)
        if n:
            adw[ym] = round(bucket["adw_sum"][ym] / n, 2)
            adw_sum += bucket["adw_sum"][ym]
            adw_n += n
        n = bucket["theo_n"].get(ym, 0)
        if n:
            theo[ym] = round(bucket["theo_sum"][ym] / n, 2)
            theo_sum += bucket["theo_sum"][ym]
            theo_n += n
        n = bucket["actual_n"].get(ym, 0)
        if n:
            actual[ym] = round(bucket["actual_sum"][ym] / n, 2)
            actual_sum += bucket["actual_sum"][ym]
            actual_n += n
    return {
        "tdw": tdw,
        "adw": adw,
        "theo": theo,
        "actual": actual,
        "tdw_avg": _avg(tdw_sum, int(tdw_n)),
        "adw_avg": _avg(adw_sum, int(adw_n)),
        "theo_avg": _avg(theo_sum, int(theo_n)),
        "actual_avg": _avg(actual_sum, int(actual_n)),
    }


def _unit_indexes(row: dict[str, Any]) -> tuple[float | None, float | None]:
    """Theo index is TDW / HouseWPU. Actual index is ADW / HouseWPU."""
    try:
        house = float(row.get("house") or 0)
    except (TypeError, ValueError):
        house = 0.0
    if house <= 0:
        return None, None
    theo = row.get("theo_index")
    actual = row.get("actual_index")
    if theo is None and row.get("tdw") is not None:
        theo = float(row["tdw"]) / house
    if actual is None and row.get("adw") is not None:
        actual = float(row["adw"]) / house
    return (None if theo is None else float(theo), None if actual is None else float(actual))


def build_expand(query: Query, casino_id: str, end: date) -> dict[str, Any]:
    """One casino, six months, nested vendor → cabinet → sign or theme → serial."""
    months = month_keys(end, 6)
    start, stop = _bounds(months)
    rows = query(
        f"""
SELECT
  {_CASINO_NAME} AS casino_name,
  {_YM} AS ym,
  RTRIM(mr.Serial_number) AS serial,
  RTRIM(mr.Vendor) AS vendor,
  RTRIM(mr.Cabinet) AS cabinet,
  RTRIM(mr.Theme) AS theme,
  CAST(mr.TDW AS float) AS tdw,
  CAST(mr.ADW AS float) AS adw,
  CAST(mr.WIN_Index AS float) AS theo_index,
  CAST(mr.actual_index AS float) AS actual_index,
  TRY_CONVERT(float, mr.HouseWPU) AS house,
  mr.slot_master_id
FROM {_MV} AS mr
{_CASINO_JOINS}
WHERE {_DATE_RANGE}
  AND {_CASINO_ID} = %s
{_UNIT_FILTER}
""",
        (start, stop, casino_id),
    )
    signs = _sign_index(query)
    casino_name = str(rows[0]["casino_name"]).strip() if rows else ""

    vendors: dict[str, Any] = {}
    for row in rows:
        ym = str(row["ym"] or "").strip()
        if ym not in months:
            continue
        vendor = str(row["vendor"] or "").strip() or "—"
        cabinet = str(row["cabinet"] or "").strip() or "—"
        theme = str(row["theme"] or "").strip() or "—"
        serial = str(row["serial"] or "").strip() or "(no serial)"
        smm = str(row["slot_master_id"] or "").strip()
        tdw = None if row["tdw"] is None else float(row["tdw"])
        adw = None if row["adw"] is None else float(row["adw"])
        theo, actual = _unit_indexes(row)
        sign = signs.get(smm)

        v = vendors.setdefault(vendor, {"bucket": _bucket(), "cabinets": {}})
        c = v["cabinets"].setdefault(cabinet, {"bucket": _bucket(), "signs": {}, "themes": {}})
        _add_month(v["bucket"], ym, tdw, adw, theo, actual)
        _add_month(c["bucket"], ym, tdw, adw, theo, actual)

        if sign:
            group = c["signs"].setdefault(
                sign["ssm"],
                {
                    "bucket": _bucket(),
                    "sign_serial": sign["sign_serial"],
                    "themes": {},
                },
            )
            leaf_parent = group["themes"].setdefault(theme, {"bucket": _bucket(), "serials": {}})
            _add_month(group["bucket"], ym, tdw, adw, theo, actual)
        else:
            leaf_parent = c["themes"].setdefault(theme, {"bucket": _bucket(), "serials": {}})
        _add_month(leaf_parent["bucket"], ym, tdw, adw, theo, actual)
        leaf_key = smm or serial
        leaf = leaf_parent["serials"].setdefault(
            leaf_key, {"bucket": _bucket(), "serial": serial, "slot_master_id": smm}
        )
        _add_month(leaf["bucket"], ym, tdw, adw, theo, actual)

    def serial_nodes(serials: dict[str, Any]) -> list[dict[str, Any]]:
        out = []
        for key in sorted(serials, key=lambda k: serials[k]["serial"].lower()):
            node = serials[key]
            out.append(
                {
                    "serial": node["serial"],
                    "slot_master_id": node["slot_master_id"],
                    **_measures(node["bucket"], months),
                }
            )
        return out

    def theme_nodes(themes: dict[str, Any]) -> list[dict[str, Any]]:
        out = []
        for name in sorted(themes, key=str.lower):
            node = themes[name]
            out.append(
                {
                    "theme": name,
                    **_measures(node["bucket"], months),
                    "serials": serial_nodes(node["serials"]),
                }
            )
        return out

    vendor_out = []
    for vendor in sorted(vendors, key=str.lower):
        vnode = vendors[vendor]
        cabinets = []
        for cabinet in sorted(vnode["cabinets"], key=str.lower):
            cnode = vnode["cabinets"][cabinet]
            sign_groups = []
            for ssm in sorted(cnode["signs"]):
                group = cnode["signs"][ssm]
                sign_groups.append(
                    {
                        "ssm": ssm,
                        "sign_serial": group["sign_serial"],
                        **_measures(group["bucket"], months),
                        "themes": theme_nodes(group["themes"]),
                    }
                )
            cabinets.append(
                {
                    "cabinet": cabinet,
                    **_measures(cnode["bucket"], months),
                    "sign_groups": sign_groups,
                    "themes": theme_nodes(cnode["themes"]),
                }
            )
        vendor_out.append(
            {
                "vendor": vendor,
                **_measures(vnode["bucket"], months),
                "cabinets": cabinets,
            }
        )

    return {
        "source": "live",
        "casino_id": casino_id,
        "casino_name": casino_name,
        "months": months,
        "vendors": vendor_out,
    }


# Census regions. Master_Revenue.State is the full state name.
_CENSUS = {
    "Northeast": (
        "Connecticut", "Maine", "Massachusetts", "New Hampshire", "Rhode Island",
        "Vermont", "New Jersey", "New York", "Pennsylvania",
    ),
    "Midwest": (
        "Illinois", "Indiana", "Michigan", "Ohio", "Wisconsin", "Iowa", "Kansas",
        "Minnesota", "Missouri", "Nebraska", "North Dakota", "South Dakota",
    ),
    "South": (
        "Delaware", "Florida", "Georgia", "Maryland", "North Carolina", "South Carolina",
        "Virginia", "West Virginia", "Alabama", "Kentucky", "Mississippi", "Tennessee",
        "Arkansas", "Louisiana", "Oklahoma", "Texas", "District of Columbia",
    ),
    "West": (
        "Arizona", "Colorado", "Idaho", "Montana", "Nevada", "New Mexico", "Utah",
        "Wyoming", "Alaska", "California", "Hawaii", "Oregon", "Washington",
    ),
}
_STATE_REGION = {name.lower(): region for region, names in _CENSUS.items() for name in names}
_ABBREV = {
    "ct": "Connecticut", "me": "Maine", "ma": "Massachusetts", "nh": "New Hampshire",
    "ri": "Rhode Island", "vt": "Vermont", "nj": "New Jersey", "ny": "New York",
    "pa": "Pennsylvania", "il": "Illinois", "in": "Indiana", "mi": "Michigan",
    "oh": "Ohio", "wi": "Wisconsin", "ia": "Iowa", "ks": "Kansas", "mn": "Minnesota",
    "mo": "Missouri", "ne": "Nebraska", "nd": "North Dakota", "sd": "South Dakota",
    "de": "Delaware", "fl": "Florida", "ga": "Georgia", "md": "Maryland",
    "nc": "North Carolina", "sc": "South Carolina", "va": "Virginia", "wv": "West Virginia",
    "al": "Alabama", "ky": "Kentucky", "ms": "Mississippi", "tn": "Tennessee",
    "ar": "Arkansas", "la": "Louisiana", "ok": "Oklahoma", "tx": "Texas", "dc": "District of Columbia",
    "az": "Arizona", "co": "Colorado", "id": "Idaho", "mt": "Montana", "nv": "Nevada",
    "nm": "New Mexico", "ut": "Utah", "wy": "Wyoming", "ak": "Alaska", "ca": "California",
    "hi": "Hawaii", "or": "Oregon", "wa": "Washington",
}


def _region_name(state: str) -> str | None:
    key = state.strip().lower()
    if key in _ABBREV:
        key = _ABBREV[key].lower()
    return _STATE_REGION.get(key)


_THEO = (
    "COALESCE(CAST(mr.WIN_Index AS float), "
    "CAST(mr.TDW AS float) / NULLIF(TRY_CONVERT(float, mr.HouseWPU), 0))"
)


def _region_case_sql() -> str:
    """Map Master_Revenue.State onto a Census region inside SQL."""
    whens = [f"WHEN '{name}' THEN N'{region}'" for name, region in _STATE_REGION.items()]
    for abbr, full in _ABBREV.items():
        whens.append(f"WHEN '{abbr}' THEN N'{_STATE_REGION[full.lower()]}'")
    return "CASE LOWER(RTRIM(mr.State)) " + " ".join(whens) + " ELSE NULL END"


def _ranked_agg(rows: list[dict[str, Any]], kind: str, limit: int, minimum: int) -> list[dict[str, Any]]:
    out = []
    for row in rows:
        if str(row.get("kind") or "") != kind:
            continue
        name = str(row.get("name") or "").strip()
        n = int(row.get("n") or 0)
        if not name or n < minimum:
            continue
        out.append(
            {
                "name": name,
                "theo_index": round(float(row["theo_sum"]) / n, 2),
                "units": int(row.get("units") or 0),
            }
        )
    out.sort(key=lambda item: (-item["theo_index"], item["name"].lower()))
    return out[:limit]


def _sign_leaders(query: Query, start: date, stop: date) -> list[dict[str, Any]]:
    """One row per loaded sign. Aggregation stays in SQL; the sign list is 11 lines."""
    signs = _sign_index(query)
    keys = [smm for smm in signs if smm]
    if not keys:
        return []
    marks = ", ".join(["%s"] * len(keys))
    rows = query(
        f"""
SELECT
  mr.slot_master_id AS smm,
  NULLIF(RTRIM(mr.Theme), N'') AS theme,
  NULLIF(RTRIM(mr.Serial_number), N'') AS serial,
  SUM({_THEO}) AS theo_sum,
  COUNT(*) AS n
FROM {_MV} AS mr
WHERE {_DATE_RANGE}
  AND TRY_CONVERT(float, mr.HouseWPU) > 0
  AND (mr.WIN_Index IS NOT NULL OR mr.TDW IS NOT NULL)
  AND mr.slot_master_id IN ({marks})
{_UNIT_FILTER}
GROUP BY mr.slot_master_id,
         NULLIF(RTRIM(mr.Theme), N''),
         NULLIF(RTRIM(mr.Serial_number), N'')
""",
        (start, stop, *keys),
    )
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        sign = signs.get(str(row.get("smm") or "").strip())
        if not sign or not row.get("n"):
            continue
        bucket = grouped.setdefault(
            sign["ssm"],
            {"sign_serial": sign["sign_serial"], "theo": 0.0, "n": 0, "serials": set(), "themes": set()},
        )
        bucket["theo"] += float(row["theo_sum"] or 0)
        bucket["n"] += int(row["n"])
        serial = str(row.get("serial") or "").strip()
        theme = str(row.get("theme") or "").strip()
        if serial:
            bucket["serials"].add(serial)
        if theme:
            bucket["themes"].add(theme)
    out = []
    for ssm, bucket in grouped.items():
        if not bucket["n"]:
            continue
        out.append(
            {
                "name": bucket["sign_serial"] or ssm,
                "detail": " · ".join(sorted(bucket["themes"], key=str.lower)),
                "theo_index": round(bucket["theo"] / bucket["n"], 2),
                "units": len(bucket["serials"]),
            }
        )
    out.sort(key=lambda item: (-item["theo_index"], item["name"].lower()))
    return out


def build_leaders(query: Query, end: date) -> dict[str, Any]:
    """Theo-index lists for the six months ending on ``end``.

    Theme, cabinet, and region averages are grouped in SQL. A sign row is
    one loaded SSM line. Themes and cabinets need at least six unit-months.
    """
    keys = month_keys(end, 6)
    start, stop = _bounds(keys)
    rows = query(
        f"""
SELECT
  CASE
    WHEN GROUPING(theme) = 0 THEN 'theme'
    WHEN GROUPING(cabinet) = 0 THEN 'cabinet'
    ELSE 'region'
  END AS kind,
  CASE
    WHEN GROUPING(theme) = 0 THEN theme
    WHEN GROUPING(cabinet) = 0 THEN cabinet
    ELSE region
  END AS name,
  SUM(theo) AS theo_sum,
  COUNT(*) AS n,
  COUNT(DISTINCT serial) AS units
FROM (
  SELECT
    NULLIF(RTRIM(mr.Theme), N'') AS theme,
    NULLIF(RTRIM(mr.Cabinet), N'') AS cabinet,
    {_region_case_sql()} AS region,
    {_THEO} AS theo,
    NULLIF(RTRIM(mr.Serial_number), N'') AS serial
  FROM {_MV} AS mr
  WHERE {_DATE_RANGE}
    AND TRY_CONVERT(float, mr.HouseWPU) > 0
    AND (mr.WIN_Index IS NOT NULL OR mr.TDW IS NOT NULL)
{_UNIT_FILTER}
) AS src
WHERE theo IS NOT NULL
GROUP BY GROUPING SETS ((theme), (cabinet), (region))
""",
        (start, stop),
    )
    return {
        "source": "live",
        "performance_month": keys[-1],
        "themes": _ranked_agg(rows, "theme", 8, 6),
        "cabinets": _ranked_agg(rows, "cabinet", 8, 6),
        "signs": _sign_leaders(query, start, stop),
        "regions": _ranked_agg(rows, "region", 4, 1),
    }
