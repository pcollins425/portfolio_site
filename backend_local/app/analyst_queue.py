"""Paul-only Analyst intake queue: self-vs-self coin-per-day watches.

Scan is read-only against dashboard.vw_performance_report.
Resolutions persist as JSON (assistant_sessions volume) until a SQL table exists.
"""
from __future__ import annotations

import json
import os
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app import mssql

_MV = "[dashboard].[vw_performance_report]"
RATIO_CUTOFF = 5.0
COIN_DAY_FLOOR = 100.0
SHORT_DOF = 5
MIN_NOTE_LETTERS = 8
MIN_NOTE_CHARS = 12
_THROWAYAY = frozenset(
    {
        "ok",
        "okay",
        "yes",
        "no",
        "looked",
        "fine",
        "good",
        "n/a",
        "na",
        "checked",
        "done",
        "lgtm",
        "pass",
    }
)
_PAUL_EMAILS = frozenset({"paulc@dynamicgamingsolutions.com"})
_PAUL_EMP = frozenset({"emp-000040"})

_RESOLVE_STATUSES = frozenset({"confirmed_ok", "needs_reload"})


def _catalog() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _query(sql: str, params=None) -> list[dict]:
    return mssql.query(sql, params=params, database=_catalog(), load_env=False)


def store_path() -> Path:
    override = (os.environ.get("ANALYST_QUEUE_STORE") or "").strip()
    if override:
        return Path(override)
    sessions_dir = Path("/app/data/assistant_sessions")
    if sessions_dir.is_dir():
        return sessions_dir / "analyst_queue.json"
    return Path(__file__).resolve().parents[1] / "data" / "analyst_queue.json"


def is_paul(user: dict[str, Any] | None) -> bool:
    if user is None:
        return True
    email = str(user.get("email") or "").strip().lower()
    emp = str(user.get("employee_id") or "").strip().lower()
    return email in _PAUL_EMAILS or emp in _PAUL_EMP


def assert_paul(user: dict[str, Any] | None) -> None:
    if not is_paul(user):
        raise HTTPException(status_code=403, detail="Analyst queue is Paul-only")


def validate_note(raw: str | None) -> str:
    text = " ".join(str(raw or "").split())
    if len(text) < MIN_NOTE_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Note required ({MIN_NOTE_CHARS}+ characters). This is the acknowledgment.",
        )
    compact = re.sub(r"[^a-z0-9]+", "", text.lower())
    if compact in _THROWAYAY or text.lower().rstrip(".!") in _THROWAYAY:
        raise HTTPException(
            status_code=400,
            detail="Note is a throwaway. Say why it is real heat, a dump, or what to reload.",
        )
    letters = sum(1 for c in text if c.isalpha())
    if letters < MIN_NOTE_LETTERS:
        raise HTTPException(status_code=400, detail="Note needs a real sentence, not punctuation.")
    return text


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _flag_id(rule: str, casino: str, serial: str, ym: str, extra: str = "") -> str:
    parts = [rule, casino.strip(), serial.strip(), ym]
    if extra:
        parts.append(extra.strip())
    return "|".join(parts)


def _load_store() -> dict[str, Any]:
    path = store_path()
    if not path.is_file():
        return {"flags": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"flags": {}}
    flags = data.get("flags")
    if not isinstance(flags, dict):
        return {"flags": {}}
    return {"flags": flags}


def _save_store(data: dict[str, Any]) -> None:
    path = store_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def _month_start(ym: str) -> date:
    raw = ym.strip()[:7]
    try:
        y, m = int(raw[:4]), int(raw[5:7])
        return date(y, m, 1)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM") from None


def _prev_month_start(d: date) -> date:
    if d.month == 1:
        return date(d.year - 1, 12, 1)
    return date(d.year, d.month - 1, 1)


def _ym(d: date) -> str:
    return d.isoformat()[:7]


FULL_SQL = f"""
WITH base AS (
    SELECT
        RTRIM(Casino) AS casino,
        RTRIM(Serial_number) AS serial,
        CONVERT(date, TRY_CONVERT(datetime, [date])) AS d,
        CAST(ISNULL(Days_on_Floor, 0) AS float) AS dof,
        CAST(ISNULL(Coin_in, 0) AS float) AS coin,
        CAST(ISNULL(Actual_win, 0) AS float) AS win
    FROM {_MV}
    WHERE TRY_CONVERT(datetime, [date]) IS NOT NULL
      AND CONVERT(date, TRY_CONVERT(datetime, [date])) >= %s
      AND CONVERT(date, TRY_CONVERT(datetime, [date])) < %s
      AND ISNULL(Days_on_Floor, 0) > 0
),
month_mach AS (
    SELECT
        casino,
        serial,
        DATEFROMPARTS(YEAR(d), MONTH(d), 1) AS ym,
        SUM(coin) AS coin,
        SUM(win) AS win,
        SUM(dof) AS dof
    FROM base
    GROUP BY casino, serial, DATEFROMPARTS(YEAR(d), MONTH(d), 1)
    HAVING SUM(dof) >= 25
)
SELECT
    cur.casino,
    cur.serial,
    CONVERT(char(7), cur.ym, 126) AS ym,
    CONVERT(char(7), prev.ym, 126) AS prev_ym,
    cur.dof,
    prev.dof AS prev_dof,
    cur.coin,
    prev.coin AS prev_coin,
    cur.win,
    prev.win AS prev_win,
    cur.coin / NULLIF(cur.dof, 0) AS coin_day,
    prev.coin / NULLIF(prev.dof, 0) AS prev_coin_day,
    cur.win / NULLIF(cur.dof, 0) AS win_day,
    prev.win / NULLIF(prev.dof, 0) AS prev_win_day
FROM month_mach AS cur
INNER JOIN month_mach AS prev
  ON prev.casino = cur.casino
 AND prev.serial = cur.serial
 AND DATEDIFF(month, prev.ym, cur.ym) = 1
WHERE cur.ym = %s
  AND prev.coin / NULLIF(prev.dof, 0) > 0
"""

SHORT_SQL = f"""
WITH base AS (
    SELECT
        RTRIM(Casino) AS casino,
        RTRIM(Serial_number) AS serial,
        RTRIM(ISNULL(Theme, '')) AS theme,
        CONVERT(date, TRY_CONVERT(datetime, [date])) AS d,
        CAST(ISNULL(Days_on_Floor, 0) AS float) AS dof,
        CAST(ISNULL(Coin_in, 0) AS float) AS coin,
        CAST(ISNULL(Actual_win, 0) AS float) AS win
    FROM {_MV}
    WHERE TRY_CONVERT(datetime, [date]) IS NOT NULL
      AND CONVERT(date, TRY_CONVERT(datetime, [date])) >= %s
      AND CONVERT(date, TRY_CONVERT(datetime, [date])) < %s
      AND ISNULL(Days_on_Floor, 0) > 0
),
month_mach AS (
    SELECT
        casino,
        serial,
        DATEFROMPARTS(YEAR(d), MONTH(d), 1) AS ym,
        SUM(coin) AS coin,
        SUM(win) AS win,
        SUM(dof) AS dof
    FROM base
    GROUP BY casino, serial, DATEFROMPARTS(YEAR(d), MONTH(d), 1)
),
full_m AS (
    SELECT * FROM month_mach WHERE dof >= 25 AND coin > 0
),
short_r AS (
    SELECT
        casino,
        serial,
        theme,
        DATEFROMPARTS(YEAR(d), MONTH(d), 1) AS ym,
        dof,
        coin,
        win,
        coin / NULLIF(dof, 0) AS coin_day,
        win / NULLIF(dof, 0) AS win_day
    FROM base
    WHERE dof <= {SHORT_DOF}
      AND DATEFROMPARTS(YEAR(d), MONTH(d), 1) = %s
)
SELECT
    s.casino,
    s.serial,
    s.theme,
    CONVERT(char(7), s.ym, 126) AS ym,
    CONVERT(char(7), p.ym, 126) AS prev_ym,
    s.dof,
    p.dof AS prev_dof,
    s.coin,
    p.coin AS prev_coin,
    s.win,
    p.win AS prev_win,
    s.coin_day,
    p.coin / NULLIF(p.dof, 0) AS prev_coin_day,
    s.win_day,
    p.win / NULLIF(p.dof, 0) AS prev_win_day
FROM short_r AS s
INNER JOIN full_m AS p
  ON p.casino = s.casino
 AND p.serial = s.serial
 AND DATEDIFF(month, p.ym, s.ym) = 1
WHERE p.coin / NULLIF(p.dof, 0) > 0
"""

ZERO_SQL = f"""
SELECT
    RTRIM(Casino) AS casino,
    RTRIM(Serial_number) AS serial,
    RTRIM(ISNULL(Theme, '')) AS theme,
    CONVERT(char(7), DATEFROMPARTS(
        YEAR(CONVERT(date, TRY_CONVERT(datetime, [date]))),
        MONTH(CONVERT(date, TRY_CONVERT(datetime, [date]))),
        1
    ), 126) AS ym,
    CAST(ISNULL(Days_on_Floor, 0) AS float) AS dof,
    CAST(ISNULL(Coin_in, 0) AS float) AS coin,
    CAST(ISNULL(Actual_win, 0) AS float) AS win
FROM {_MV}
WHERE TRY_CONVERT(datetime, [date]) IS NOT NULL
  AND CONVERT(date, TRY_CONVERT(datetime, [date])) >= %s
  AND CONVERT(date, TRY_CONVERT(datetime, [date])) < %s
  AND ISNULL(Days_on_Floor, 0) > 0
  AND ISNULL(Coin_in, 0) = 0
  AND ABS(ISNULL(Actual_win, 0)) >= 0.01
"""


def _ratio_row(
    *,
    rule: str,
    side: str,
    row: dict,
    extra: str = "",
) -> dict[str, Any]:
    casino = str(row.get("casino") or "").strip() or "?"
    serial = str(row.get("serial") or "").strip() or "?"
    ym = str(row.get("ym") or "").strip()[:7]
    coin_day = _f(row.get("coin_day"))
    prev_coin_day = _f(row.get("prev_coin_day"))
    ratio = coin_day / prev_coin_day if prev_coin_day else None
    return {
        "id": _flag_id(rule, casino, serial, ym, extra),
        "rule": rule,
        "side": side,
        "casino": casino,
        "serial": serial,
        "theme": str(row.get("theme") or "").strip() or None,
        "ym": ym,
        "prev_ym": str(row.get("prev_ym") or "").strip()[:7] or None,
        "dof": _f(row.get("dof")),
        "prev_dof": _f(row.get("prev_dof")),
        "coin": _f(row.get("coin")),
        "prev_coin": _f(row.get("prev_coin")),
        "win": _f(row.get("win")),
        "prev_win": _f(row.get("prev_win")),
        "coin_day": coin_day,
        "prev_coin_day": prev_coin_day,
        "win_day": _f(row.get("win_day")),
        "prev_win_day": _f(row.get("prev_win_day")),
        "coin_ratio": ratio,
        "status": "open",
        "note": None,
        "notes": [],
        "resolved_at": None,
        "resolved_by": None,
    }


def _scan_month(target: date) -> list[dict[str, Any]]:
    prev = _prev_month_start(target)
    window_end = date(target.year + (1 if target.month == 12 else 0), 1 if target.month == 12 else target.month + 1, 1)
    flags: list[dict[str, Any]] = []

    for row in _query(FULL_SQL, (prev, window_end, target)):
        prev_day = _f(row.get("prev_coin_day"))
        cur_day = _f(row.get("coin_day"))
        if prev_day < COIN_DAY_FLOOR:
            continue
        if prev_day <= 0:
            continue
        ratio = cur_day / prev_day
        if ratio >= RATIO_CUTOFF and cur_day >= COIN_DAY_FLOOR:
            flags.append(_ratio_row(rule="coin_high", side="high", row=row))
        elif ratio <= (1.0 / RATIO_CUTOFF):
            flags.append(_ratio_row(rule="coin_low", side="low", row=row))

    for row in _query(SHORT_SQL, (prev, window_end, target)):
        prev_day = _f(row.get("prev_coin_day"))
        cur_day = _f(row.get("coin_day"))
        if prev_day < COIN_DAY_FLOOR or prev_day <= 0:
            continue
        ratio = cur_day / prev_day
        extra = str(row.get("theme") or "")
        if ratio >= RATIO_CUTOFF:
            flags.append(_ratio_row(rule="short_high", side="high", row=row, extra=extra))
        elif ratio <= (1.0 / RATIO_CUTOFF):
            flags.append(_ratio_row(rule="short_low", side="low", row=row, extra=extra))

    for row in _query(ZERO_SQL, (target, window_end)):
        casino = str(row.get("casino") or "").strip() or "?"
        serial = str(row.get("serial") or "").strip() or "?"
        ym = str(row.get("ym") or _ym(target)).strip()[:7]
        theme = str(row.get("theme") or "").strip()
        flags.append(
            {
                "id": _flag_id("zero_coin_win", casino, serial, ym, theme),
                "rule": "zero_coin_win",
                "side": "low",
                "casino": casino,
                "serial": serial,
                "theme": theme or None,
                "ym": ym,
                "prev_ym": None,
                "dof": _f(row.get("dof")),
                "prev_dof": None,
                "coin": _f(row.get("coin")),
                "prev_coin": None,
                "win": _f(row.get("win")),
                "prev_win": None,
                "coin_day": 0.0,
                "prev_coin_day": None,
                "win_day": _f(row.get("win")) / _f(row.get("dof")) if _f(row.get("dof")) else None,
                "prev_win_day": None,
                "coin_ratio": None,
                "status": "open",
                "note": None,
                "notes": [],
                "resolved_at": None,
                "resolved_by": None,
            }
        )

    flags.sort(key=lambda f: (abs(f.get("coin_ratio") or 0), f["casino"], f["serial"]), reverse=True)
    return flags


def _merge_resolution(flag: dict[str, Any], stored: dict[str, Any] | None) -> dict[str, Any]:
    if not stored:
        return flag
    out = dict(flag)
    out["status"] = stored.get("status") or "open"
    out["note"] = stored.get("note")
    out["notes"] = stored.get("notes") or []
    out["resolved_at"] = stored.get("resolved_at")
    out["resolved_by"] = stored.get("resolved_by")
    return out


def queue_for_month(month: str, *, status: str = "open") -> dict[str, Any]:
    target = _month_start(month)
    live = _scan_month(target)
    store = _load_store()
    saved = store["flags"]
    all_flags = [_merge_resolution(f, saved.get(f["id"])) for f in live]
    want = (status or "open").strip().lower()
    merged = all_flags if want == "all" else [f for f in all_flags if (f.get("status") or "open") == want]
    open_n = sum(1 for f in all_flags if (f.get("status") or "open") == "open")
    return {
        "source": "live",
        "month": _ym(target),
        "prev_month": _ym(_prev_month_start(target)),
        "cutoff": RATIO_CUTOFF,
        "coin_day_floor": COIN_DAY_FLOOR,
        "compare": "serial_self_coin_per_day",
        "open_count": open_n,
        "count": len(merged),
        "store": str(store_path()),
        "flags": merged,
    }


def resolve_flag(
    flag_id: str,
    *,
    status: str,
    note: str,
    user: dict[str, Any] | None,
) -> dict[str, Any]:
    fid = (flag_id or "").strip()
    if not fid:
        raise HTTPException(status_code=400, detail="flag id required")
    st = (status or "").strip()
    if st not in _RESOLVE_STATUSES:
        raise HTTPException(status_code=400, detail="status must be confirmed_ok or needs_reload")
    text = validate_note(note)
    who = None
    if user:
        who = str(user.get("email") or user.get("employee_id") or "paul").strip()
    else:
        who = "local"
    now = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"

    store = _load_store()
    prev = store["flags"].get(fid) or {"notes": []}
    notes = list(prev.get("notes") or [])
    notes.append({"at": now, "by": who, "status": st, "note": text})
    store["flags"][fid] = {
        "status": st,
        "note": text,
        "notes": notes,
        "resolved_at": now,
        "resolved_by": who,
    }
    _save_store(store)
    return store["flags"][fid]
