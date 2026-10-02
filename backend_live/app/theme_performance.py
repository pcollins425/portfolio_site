"""What to expect from a catalog theme, as a life of Win Index.

A life is one placement: this theme, on one asset, at one casino, from the
first full revenue month until it is converted off, removed, or still running.
A month with 5 or fewer days on the floor does not start a life and does not
count in the path. Revenue stamped with a slot-master id belongs to that
stint. Older rows often have a blank id; those count only when the serial,
casino, and theme name match one stint that covers the month. The line is
the median Win Index of placements still on the theme in that month of life.
The shade is the middle half. The chart draws the first 12 months of each life.

Warning is 0.71–0.99. Dead is 0.70 and under. A band's clock starts after two
consecutive full months in that band. One soft month is variance. Recovering
above house clears both clocks. Recovering from dead into warning clears dead
only. A theme conversion or a remove stops the clock. The earlier one wins.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from datetime import date, datetime
from typing import Any

MIN_DAYS = 5
CHART_MONTHS = 12
ABOVE = 1.0
DEAD = 0.70


def attach_unstamped_months(stints: list[dict], blank_rows: list[dict], theme_id: str, theme_name: str) -> list[dict]:
    """Give a blank slot-master id a home when one covering stint is obvious."""
    windows: dict[str, tuple[date, date | None]] = {}
    for stint in stints:
        if str(stint.get("theme_id") or "").strip() != theme_id:
            continue
        slot = str(stint.get("slot_master_id") or "").strip()
        start = _stint_start(stint)
        if not slot or start is None:
            continue
        rmvl = _as_date(stint.get("rmvl_date"))
        windows[slot] = (
            date(start.year, start.month, 1),
            date(rmvl.year, rmvl.month, 1) if rmvl else None,
        )

    want = _name_key(theme_name)
    grouped: dict[tuple[str, str, date], list[dict]] = defaultdict(list)
    for row in blank_rows:
        if _name_key(str(row.get("mr_theme") or "")) != want:
            continue
        slot = str(row.get("slot_master_id") or "").strip()
        window = windows.get(slot)
        report = _as_date(row.get("report_date"))
        if window is None or report is None:
            continue
        report_month = date(report.year, report.month, 1)
        start_month, rmvl_month = window
        if report_month < start_month:
            continue
        if rmvl_month is not None and report_month > rmvl_month:
            continue
        key = (
            str(row.get("serial_number") or "").strip().upper(),
            str(row.get("casino_id") or "").strip(),
            report_month,
        )
        grouped[key].append(row)

    attached = []
    for hits in grouped.values():
        slots = {str(hit.get("slot_master_id") or "").strip() for hit in hits}
        if len(slots) != 1:
            continue
        hit = hits[0]
        attached.append(
            {
                "slot_master_id": next(iter(slots)),
                "report_date": hit.get("report_date"),
                "win_index": hit.get("win_index"),
                "days_on_floor": hit.get("days_on_floor"),
            }
        )
    return attached


def build_expectation(stints: list[dict], months: list[dict], theme_id: str) -> dict:
    lives = _lives(stints, theme_id)
    by_slot: dict[str, dict] = {}
    for life in lives:
        for slot_id in life["slot_ids"]:
            by_slot[slot_id] = life
    for row in months:
        life = by_slot.get(str(row.get("slot_master_id") or ""))
        if life is None:
            continue
        report = _as_date(row.get("report_date"))
        index = _as_float(row.get("win_index"))
        if report is None or index is None:
            continue
        life["rows"].append(
            {
                "month": date(report.year, report.month, 1),
                "win_index": index,
                "days": _as_float(row.get("days_on_floor")),
            }
        )

    series: dict[int, list[float]] = defaultdict(list)
    warn_lags: list[int] = []
    dead_lags: list[int] = []
    swaps = 0
    pulls = 0
    placed = 0

    for life in lives:
        path = _path(life)
        if not path:
            continue
        placed += 1
        ending_month = _as_date(life.get("ending_on"))
        if ending_month is not None:
            ending_month = date(ending_month.year, ending_month.month, 1)
        for month_no, _when, index in path:
            if ending_month is not None and _when > ending_month:
                continue
            if 1 <= month_no <= CHART_MONTHS:
                series[month_no].append(index)
        if life.get("ending") == "theme_swap":
            swaps += 1
        elif life.get("ending") == "cabinet_pull":
            pulls += 1
        if ending_month is None:
            continue
        warn_on, dead_on = _open_clocks(path, ending_month)
        if warn_on is not None:
            lag = _month_delta(warn_on, ending_month)
            if lag >= 0:
                warn_lags.append(lag)
        if dead_on is not None:
            lag = _month_delta(dead_on, ending_month)
            if lag >= 0:
                dead_lags.append(lag)

    points = []
    last = max(series) if series else 0
    last = min(last, CHART_MONTHS)
    for month_no in range(1, last + 1):
        values = sorted(series.get(month_no) or [])
        if not values:
            points.append({"month": month_no, "n": 0, "low": None, "median": None, "high": None})
            continue
        points.append(
            {
                "month": month_no,
                "n": len(values),
                "low": _round(_percentile(values, 0.25)),
                "median": _round(_percentile(values, 0.50)),
                "high": _round(_percentile(values, 0.75)),
            }
        )

    y_max = 3.0
    peak_high = max((p["high"] for p in points if p["high"] is not None), default=0)
    if peak_high > 2.9:
        y_max = math.ceil((peak_high + 0.05) * 2) / 2

    populated = [p for p in points if p["n"]]
    fade_from = None
    if populated:
        base = populated[0]["n"]
        threshold = max(4, round(0.3 * base))
        for point in populated[1:]:
            if point["n"] < threshold:
                fade_from = point["month"]
                break

    n12 = next((p["n"] for p in points if p["month"] == 12), None)
    return {
        "available": True,
        "placements": placed,
        "y_max": y_max,
        "fade_from": fade_from,
        "months": points,
        "summary": _summary(points, placed, warn_lags, dead_lags, swaps, pulls, n12, fade_from),
    }


def unavailable() -> dict:
    return {
        "available": False,
        "placements": 0,
        "y_max": 3.0,
        "fade_from": None,
        "months": [],
        "summary": ["Indexed performance could not be loaded."],
    }


def _lives(stints: list[dict], theme_id: str) -> list[dict]:
    groups: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for row in stints:
        asset = str(row.get("asset_id") or "").strip()
        casino = str(row.get("casino_id") or "").strip()
        slot_id = str(row.get("slot_master_id") or "").strip()
        if not asset or not casino or not slot_id:
            continue
        groups[(asset, casino)].append(
            {
                "slot_master_id": slot_id,
                "theme_id": str(row.get("theme_id") or "").strip(),
                "start": _stint_start(row),
                "rmvl_date": _as_date(row.get("rmvl_date")),
            }
        )

    lives = []
    for group in groups.values():
        group.sort(key=lambda s: (s["start"] is None, s["start"] or date.min, s["slot_master_id"]))
        current = None
        for stint in group:
            same = stint["theme_id"] == theme_id
            if current and current.get("rmvl_date") and same:
                nxt = stint["start"]
                if nxt is None or nxt > current["rmvl_date"]:
                    current["ending"] = "cabinet_pull"
                    current["ending_on"] = current["rmvl_date"]
                    lives.append(current)
                    current = None
            if not same:
                if current:
                    pull_on = current.get("rmvl_date")
                    swap_on = stint["start"]
                    if pull_on and (swap_on is None or pull_on <= swap_on):
                        current["ending"] = "cabinet_pull"
                        current["ending_on"] = pull_on
                    else:
                        current["ending"] = "theme_swap"
                        current["ending_on"] = swap_on
                    lives.append(current)
                    current = None
                continue
            if current is None:
                current = {
                    "slot_ids": [stint["slot_master_id"]],
                    "rmvl_date": stint["rmvl_date"],
                    "ending": None,
                    "ending_on": None,
                    "rows": [],
                }
            else:
                current["slot_ids"].append(stint["slot_master_id"])
                if stint["rmvl_date"]:
                    current["rmvl_date"] = stint["rmvl_date"]
        if current:
            if current.get("rmvl_date"):
                current["ending"] = "cabinet_pull"
                current["ending_on"] = current["rmvl_date"]
            lives.append(current)
    return lives


def _stint_start(row: dict) -> date | None:
    action = str(row.get("action") or "").strip().upper()
    lastconver = _as_date(row.get("lastconver"))
    if action in ("CONVERT", "UPGRADE") and lastconver is not None:
        return lastconver
    return _as_date(row.get("golive001")) or _as_date(row.get("date_instl")) or lastconver


def _path(life: dict) -> list[tuple[int, date, float]]:
    best: dict[date, tuple[float, float]] = {}
    for row in life["rows"]:
        days = row["days"]
        if days is not None and days <= MIN_DAYS:
            continue
        current = best.get(row["month"])
        weight = days if days is not None else 0
        if current is None or weight > current[1]:
            best[row["month"]] = (row["win_index"], weight)
    if not best:
        return []
    first = min(best)
    out = []
    for month in sorted(best):
        month_no = 1 + _month_delta(first, month)
        out.append((month_no, month, best[month][0]))
    return out


def _open_clocks(path: list[tuple[int, date, float]], ending_month: date) -> tuple[date | None, date | None]:
    warn_entry = None
    dead_entry = None
    warn_run = 0
    dead_run = 0
    prev_when = None
    prev_band = None
    for _month_no, when, index in path:
        if when > ending_month:
            break
        band = _band(index)
        adjacent = prev_when is not None and _month_delta(prev_when, when) == 1
        if band == "warning" and adjacent and prev_band == "warning":
            warn_run += 1
        elif band == "warning":
            warn_run = 1
        else:
            warn_run = 0
        if band == "dead" and adjacent and prev_band == "dead":
            dead_run += 1
        elif band == "dead":
            dead_run = 1
        else:
            dead_run = 0
        if warn_run >= 2 and warn_entry is None:
            warn_entry = when
        if dead_run >= 2 and dead_entry is None:
            dead_entry = when
        if band == "above":
            warn_entry = None
            dead_entry = None
        elif band == "warning":
            dead_entry = None
        prev_when = when
        prev_band = band
    return warn_entry, dead_entry


def _band(index: float) -> str:
    if index <= DEAD:
        return "dead"
    if index < ABOVE:
        return "warning"
    return "above"


def _summary(points, placed, warn_lags, dead_lags, swaps, pulls, n12, fade_from) -> list[str]:
    if not placed:
        return ["No indexed months for this theme yet."]
    populated = [p for p in points if p["median"] is not None]
    if not populated:
        return ["No indexed months for this theme yet."]
    peak = max(populated, key=lambda p: p["median"])
    under = next((p["month"] for p in populated if p["median"] < ABOVE), None)
    dead = next((p["month"] for p in populated if p["median"] <= DEAD), None)
    sentence = f"The typical life peaks near {_fmt(peak['median'])} in month {peak['month']}"
    tails = []
    if under is not None and under > peak["month"]:
        tails.append(f"slips under house by month {under}")
    elif under is not None:
        tails.append(f"is under house from month {under}")
    elif populated[-1]["median"] >= ABOVE:
        tails.append(f"stays above house through month {populated[-1]['month']}")
    if dead is not None:
        tails.append(f"is in dead by month {dead}")
    if not tails:
        sentence += "."
    elif len(tails) == 1:
        sentence += f", and {tails[0]}."
    else:
        sentence += ", " + ", ".join(tails[:-1]) + f", and {tails[-1]}."

    lines = [sentence]
    action = _action_sentence(warn_lags, dead_lags, swaps, pulls)
    if action:
        lines.append(action)
    if n12 is not None:
        tail = f"Month 12 is {n12} placements still running out of {placed}."
        if fade_from:
            tail += " The faded tail is whoever was left."
        lines.append(tail)
    else:
        lines.append(
            f"{placed} placements, and the longest indexed life on this chart is month {populated[-1]['month']}."
        )
    return lines


def _action_sentence(warn_lags, dead_lags, swaps, pulls) -> str:
    bits = []
    if warn_lags:
        bits.append(_wait_phrase(warn_lags, "warning"))
    if dead_lags:
        bits.append(_wait_phrase(dead_lags, "dead"))
    if not bits and not swaps and not pulls:
        return ""
    sentence = ""
    if bits:
        sentence = "We usually act " + " and ".join(bits) + "."
    if swaps or pulls:
        if swaps >= pulls:
            ending = "Most endings are a theme swap."
            if pulls:
                ending += " The rest are cabinet pulls."
        else:
            ending = "Most endings are a cabinet pull."
            if swaps:
                ending += " The rest are theme swaps."
        sentence = f"{sentence} {ending}".strip()
    return sentence


def _wait_phrase(lags: list[int], band: str) -> str:
    value = int(math.floor(_percentile(sorted(lags), 0.5) + 0.5))
    sample = _sample(len(lags))
    if value == 0:
        return f"in the same month {band} is confirmed{sample}"
    unit = "month" if value == 1 else "months"
    return f"about {value} {unit} after {band}{sample}"


def _sample(count: int) -> str:
    if count >= 8:
        return ""
    unit = "placement" if count == 1 else "placements"
    return f" ({count} {unit})"


def _percentile(values: list[float], p: float) -> float:
    if len(values) == 1:
        return float(values[0])
    k = (len(values) - 1) * p
    lo = math.floor(k)
    hi = math.ceil(k)
    if lo == hi:
        return float(values[int(k)])
    return float(values[lo]) * (hi - k) + float(values[hi]) * (k - lo)


def _month_delta(start: date, end: date) -> int:
    return (end.year - start.year) * 12 + (end.month - start.month)


def _fmt(value: float) -> str:
    return f"{value:.1f}"


def _round(value: float) -> float:
    return round(float(value), 4)


def _as_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text:
        return None
    return date.fromisoformat(text[:10])


def _name_key(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (name or "").lower())


def _as_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(number):
        return None
    return number
