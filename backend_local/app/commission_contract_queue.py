"""Paul-only commission contract queue: Reported (A) vs Calculated (B).

Scan is read-only against dashboard.vw_performance_report + SMM profiles.
Resolutions persist as JSON (assistant_sessions volume) until a SQL table exists.

UI shape (locked 2026-08-21): one queue, A+B on same row; kinds delta|missing|unknown;
Analyst-style month rail; closes bill_a|bill_b|needs_root_fix|amount_due_only.
"""
from __future__ import annotations

import json
import os
import re
import time
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from app import mssql

_MV = "[dashboard].[vw_performance_report]"
SEAT_HARD_ABS = 1.00
PROPERTY_PASS_ABS = 0.05
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
_RESOLVE_STATUSES = frozenset(
    {"bill_a", "bill_b", "needs_root_fix", "amount_due_only"}
)
_KINDS = frozenset({"delta", "missing", "unknown"})

_SUMMARY_TTL_SEC = 60.0
_SCAN_TTL_SEC = 900.0
_summary_cache: dict[str, Any] = {"key": None, "at": 0.0, "data": None}
_scan_cache: dict[str, Any] = {"from": None, "to": None, "at": 0.0, "flags": None}


def _catalog() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _query(sql: str, params=None) -> list[dict]:
    return mssql.query(sql, params=params, database=_catalog(), load_env=False)


def store_path() -> Path:
    override = (os.environ.get("COMMISSION_CONTRACT_STORE") or "").strip()
    if override:
        return Path(override)
    sessions_dir = Path("/app/data/assistant_sessions")
    if sessions_dir.is_dir():
        return sessions_dir / "commission_contract_queue.json"
    return Path(__file__).resolve().parents[1] / "data" / "commission_contract_queue.json"


def is_paul(user: dict[str, Any] | None) -> bool:
    if user is None:
        return True
    email = str(user.get("email") or "").strip().lower()
    emp = str(user.get("employee_id") or "").strip().lower()
    return email in _PAUL_EMAILS or emp in _PAUL_EMP


def assert_paul(user: dict[str, Any] | None) -> None:
    if not is_paul(user):
        raise HTTPException(status_code=403, detail="Commission contract queue is Paul-only")


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
            detail="Note is a throwaway. Say why bill A, bill B, root fix, or amount-due-only.",
        )
    letters = sum(1 for c in text if c.isalpha())
    if letters < MIN_NOTE_LETTERS:
        raise HTTPException(status_code=400, detail="Note needs a real sentence, not punctuation.")
    return text


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


def _invalidate_summary() -> None:
    _summary_cache["key"] = None
    _summary_cache["data"] = None


def _month_start(ym: str) -> date:
    raw = ym.strip()[:7]
    try:
        y, m = int(raw[:4]), int(raw[5:7])
        return date(y, m, 1)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="month must be YYYY-MM") from None


def _add_months(d: date, n: int) -> date:
    m = d.month - 1 + n
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, 1)


def _ym(d: date) -> str:
    return d.isoformat()[:7]


def _months_between(start: date, end: date) -> int:
    return (end.year - start.year) * 12 + (end.month - start.month) + 1


def commission_id_from_profile(value: object) -> int | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    tail = text.rsplit("-", 1)[-1]
    try:
        return int(tail)
    except ValueError:
        return None


def recipe_label(commission_id: int | None) -> str | None:
    if commission_id is None:
        return None
    labels = {
        1: "20% Actual Win",
        2: "18% Actual Win",
        4: "20% − $1/day",
        5: "16.45% − $3.50/day",
        6: "20% − $2.50/day",
        9: "20% − $0.25/day",
        10: "19% − $1.50/day",
        12: "15% Actual Win",
        13: "20% w/ rebate + 7.5% tax",
        14: "greater of 20% or $1",
        15: "20%; no loss passed",
        17: "greater of 20% or $35/day",
        19: "20% / $60/day max",
        23: "$45/day rent",
        24: "17% / $60/day max",
        27: "15%; no loss passed",
        29: "greater of 20% or $1, $55/day cap",
        30: "20% / $85/day cap",
        33: "20% / $55/day max; loss passed",
        34: "greater of 20% or $1, then $50/day cap",
        35: "20% of (Actual Win − Promo)",
    }
    return labels.get(int(commission_id), f"CID {commission_id}")


def commission_from_id(
    actual_win: float,
    commission_id: int | None,
    *,
    days: int | None = None,
    promo: float | None = None,
) -> float | None:
    if commission_id is None:
        return None
    if commission_id == 1:
        return round(float(actual_win) * 0.2, 2)
    # Indigo Sky: 20% Actual Win − $2.50 × Days_on_Floor (COM-000006)
    if commission_id == 6 and days is not None and days > 0:
        return round(float(actual_win) * 0.20 - int(days) * 2.5, 2)
    if commission_id == 12:
        return round(float(actual_win) * 0.15, 2)
    if commission_id == 29 and days is not None and days > 0:
        c = round(float(actual_win) * 0.2, 2)
        cap = int(days) * 55.0
        if c > cap:
            c = cap
        return 1.0 if c < 1 else c
    if commission_id == 30 and days is not None and days > 0:
        c = round(float(actual_win) * 0.2, 2)
        if c < 1:
            c = 1.0
        cap = int(days) * 85.0
        return round(c if c < cap else cap, 2)
    if commission_id == 33 and days is not None and days > 0:
        c = round(float(actual_win) * 0.2, 2)
        cap = int(days) * 55.0
        return cap if c > cap else c
    if commission_id == 9 and days is not None and days > 0:
        return round(float(actual_win) * 0.20 - int(days) * 0.25, 2)
    if commission_id == 14:
        c = round(float(actual_win) * 0.2, 2)
        return c if c > 1 else 1.0
    if commission_id == 17 and days is not None and days > 0:
        c = round(float(actual_win) * 0.2, 2)
        floor = int(days) * 35.0
        return c if c >= floor else floor
    if commission_id == 34 and days is not None and days > 0:
        c = round(float(actual_win) * 0.2, 2)
        if c <= 1:
            return 1.0
        cap = int(days) * 50.0
        return round(c if c < cap else cap, 2)
    if commission_id == 24 and days is not None and days > 0:
        c = round(float(actual_win) * 0.17, 2)
        cap = int(days) * 60.0
        return round(c if c < cap else cap, 2)
    if commission_id == 4 and days is not None and days > 0:
        return round(float(actual_win) * 0.20 - int(days) * 1.0, 2)
    if commission_id == 5 and days is not None and days > 0:
        return round(float(actual_win) * 0.1645 - int(days) * 3.5, 2)
    # COM-000015: 20%; no loss passed (negative → $0)
    if commission_id == 15:
        c = round(float(actual_win) * 0.2, 2)
        return 0.0 if c < 0 else c
    # COM-000027: 15%; no loss passed (negative → $0)
    if commission_id == 27:
        c = round(float(actual_win) * 0.15, 2)
        return 0.0 if c < 0 else c
    # COM-000019: 20% with $60/day maximum
    if commission_id == 19 and days is not None and days > 0:
        c = round(float(actual_win) * 0.2, 2)
        if c < 0:
            c = 0.0
        cap = int(days) * 60.0
        return round(c if c < cap else cap, 2)
    if commission_id == 23 and days is not None and days > 0:
        return round(45.0 * int(days), 2)
    if commission_id == 10 and days is not None and days > 0:
        return round(float(actual_win) * 0.19 - int(days) * 1.50, 2)
    # Kickapoo Finley-Cook: 20% of (Actual Win − Promo). Fees in Billed_Fees (COM-000035).
    if commission_id == 35:
        p = 0.0 if promo is None else float(promo)
        return round((float(actual_win) - p) * 0.2, 2)
    if commission_id == 13:
        gross_20 = round(float(actual_win) * 0.2, 2)
        reduction = round(gross_20 * 0.0875, 2)
        subtotal = round(gross_20 - reduction, 2)
        tax = round(subtotal * 0.075, 2)
        return round(subtotal + tax, 2)
    return None


def _flag_id(kind: str, casino: str, serial: str, ym: str, extra: str = "") -> str:
    parts = [kind, casino.strip(), serial.strip(), ym]
    if extra:
        parts.append(extra.strip())
    return "|".join(parts)


def _f(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _fetch_mr_range(start: date, end: date) -> list[dict]:
    return _query(
        f"""
        SELECT
            RTRIM(Casino) AS casino,
            RTRIM(ISNULL(Tribe, '')) AS tribe,
            RTRIM(Serial_number) AS serial,
            RTRIM(ISNULL(Vendor, '')) AS vendor,
            RTRIM(ISNULL(Theme, '')) AS theme,
            CAST(ISNULL(Days_on_Floor, 0) AS int) AS dof,
            CAST(ISNULL(Actual_win, 0) AS float) AS actual_win,
            CAST(ISNULL(Promo, 0) AS float) AS promo,
            CAST(ISNULL(Commission, 0) AS float) AS commission_a,
            Commission_ID AS mr_commission_id,
            RTRIM(CAST(slot_master_id AS nvarchar(50))) AS slot_master_id,
            CONVERT(char(7), DATEFROMPARTS(
                YEAR(CONVERT(date, TRY_CONVERT(datetime, [date]))),
                MONTH(CONVERT(date, TRY_CONVERT(datetime, [date]))),
                1
            ), 126) AS ym
        FROM {_MV}
        WHERE TRY_CONVERT(datetime, [date]) IS NOT NULL
          AND CONVERT(date, TRY_CONVERT(datetime, [date])) >= %s
          AND CONVERT(date, TRY_CONVERT(datetime, [date])) < %s
          AND ISNULL(Days_on_Floor, 0) > 0
        """,
        (start, end),
    )


def _fetch_profiles(ids: list[str]) -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    chunk = 400
    for i in range(0, len(ids), chunk):
        part = ids[i : i + chunk]
        placeholders = ",".join(["%s"] * len(part))
        rows = _query(
            f"""
            SELECT reference_key, commission_profile_id
            FROM inventory.slot_master_migration
            WHERE reference_key IN ({placeholders})
            """,
            tuple(part),
        )
        for r in rows:
            out[str(r["reference_key"])] = r.get("commission_profile_id")
    return out


def _classify_row(mr: dict, profile_id: str | None) -> dict[str, Any] | None:
    a = round(_f(mr.get("commission_a")), 2)
    dof = int(mr.get("dof") or 0)
    win = _f(mr.get("actual_win"))
    promo = _f(mr.get("promo"))
    serial = str(mr.get("serial") or "").strip() or "?"
    casino = str(mr.get("casino") or "").strip() or "?"
    ym = str(mr.get("ym") or "").strip()[:7]
    if len(ym) < 7:
        return None

    base: dict[str, Any] = {
        "id": "",
        "kind": None,
        "casino": casino,
        "tribe": str(mr.get("tribe") or "").strip() or None,
        "serial": serial,
        "vendor": str(mr.get("vendor") or "").strip() or None,
        "theme": str(mr.get("theme") or "").strip() or None,
        "ym": ym,
        "dof": dof,
        "actual_win": round(win, 2),
        "reported_a": a,
        "calculated_b": None,
        "delta": None,
        "commission_id": None,
        "profile_id": profile_id,
        "mr_commission_id": int(mr["mr_commission_id"])
        if mr.get("mr_commission_id") is not None
        else None,
        "slot_master_id": mr.get("slot_master_id"),
        "recipe": None,
        "status": "open",
        "note": None,
        "notes": [],
        "resolved_at": None,
        "resolved_by": None,
    }

    cid = commission_id_from_profile(profile_id)
    if not profile_id or cid is None:
        base["kind"] = "missing"
        base["id"] = _flag_id("missing", casino, serial, ym, str(mr.get("slot_master_id") or ""))
        return base

    base["commission_id"] = cid
    base["recipe"] = recipe_label(cid)
    formula = commission_from_id(
        win, cid, days=dof if dof > 0 else None, promo=promo
    )
    if formula is None:
        base["kind"] = "unknown"
        base["id"] = _flag_id("unknown", casino, serial, ym, str(profile_id))
        return base

    b = round(float(formula), 2)
    abs_d = abs(round(a - b, 2))
    base["calculated_b"] = b
    base["delta"] = abs_d
    if abs_d >= SEAT_HARD_ABS:
        base["kind"] = "delta"
        base["id"] = _flag_id("delta", casino, serial, ym, str(profile_id))
        return base
    return None


def _scan_flags(start: date, end: date) -> list[dict[str, Any]]:
    mr_rows = _fetch_mr_range(start, end)
    ids = sorted(
        {
            str(r["slot_master_id"]).strip()
            for r in mr_rows
            if r.get("slot_master_id") and str(r["slot_master_id"]).strip()
        }
    )
    profiles = _fetch_profiles(ids)
    flags: list[dict[str, Any]] = []
    signed_by: dict[tuple[str, str], float] = defaultdict(float)
    checked_by: dict[tuple[str, str], int] = defaultdict(int)
    seat_hard: set[tuple[str, str]] = set()

    for r in mr_rows:
        sid = str(r.get("slot_master_id") or "").strip() or None
        profile = profiles.get(sid) if sid else None
        cid = commission_id_from_profile(profile)
        ym = str(r.get("ym") or "").strip()[:7]
        casino = str(r.get("casino") or "").strip() or "?"
        if profile and cid is not None and len(ym) >= 7:
            formula = commission_from_id(
                _f(r.get("actual_win")),
                cid,
                days=int(r.get("dof") or 0) or None,
                promo=_f(r.get("promo")),
            )
            if formula is not None:
                a = round(_f(r.get("commission_a")), 2)
                b = round(float(formula), 2)
                signed_by[(casino, ym)] += a - b
                checked_by[(casino, ym)] += 1

        flag = _classify_row(r, profile)
        if flag:
            flags.append(flag)
            if flag["kind"] == "delta":
                seat_hard.add((flag["casino"], flag["ym"]))

    for (casino, ym), signed in signed_by.items():
        prop_abs = abs(round(signed, 2))
        if prop_abs < SEAT_HARD_ABS:
            continue
        if (casino, ym) in seat_hard:
            continue
        flags.append(
            {
                "id": _flag_id("delta", casino, "(property)", ym, "sum"),
                "kind": "delta",
                "casino": casino,
                "tribe": None,
                "serial": "(property)",
                "vendor": None,
                "theme": None,
                "ym": ym,
                "dof": None,
                "actual_win": None,
                "reported_a": None,
                "calculated_b": None,
                "delta": prop_abs,
                "commission_id": None,
                "profile_id": None,
                "mr_commission_id": None,
                "slot_master_id": None,
                "recipe": None,
                "status": "open",
                "note": None,
                "notes": [],
                "resolved_at": None,
                "resolved_by": None,
                "detail": (
                    f"property |Σ(A−B)|=${prop_abs:.2f} across "
                    f"{checked_by[(casino, ym)]} checked seats"
                ),
            }
        )

    flags.sort(
        key=lambda f: (
            -(f.get("delta") or 0),
            str(f.get("kind") or ""),
            str(f.get("casino") or ""),
            str(f.get("serial") or ""),
        )
    )
    return flags


def _cached_scan(start: date, end: date) -> list[dict[str, Any]]:
    now = time.monotonic()
    cs, ce = _scan_cache.get("from"), _scan_cache.get("to")
    flags = _scan_cache.get("flags")
    if (
        flags is not None
        and cs is not None
        and ce is not None
        and start >= cs
        and end <= ce
        and now - float(_scan_cache.get("at") or 0) < _SCAN_TTL_SEC
    ):
        out = []
        for f in flags:
            ym = str(f.get("ym") or "")[:7]
            try:
                d = _month_start(ym)
            except HTTPException:
                continue
            if start <= d < end:
                out.append(f)
        return out
    flags = _scan_flags(start, end)
    _scan_cache["from"] = start
    _scan_cache["to"] = end
    _scan_cache["at"] = now
    _scan_cache["flags"] = flags
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


def _earliest_month() -> date | None:
    rows = _query(
        f"""
        SELECT CONVERT(char(7), MIN(DATEFROMPARTS(
            YEAR(CONVERT(date, TRY_CONVERT(datetime, [date]))),
            MONTH(CONVERT(date, TRY_CONVERT(datetime, [date]))),
            1
        )), 126) AS ym
        FROM {_MV}
        WHERE TRY_CONVERT(datetime, [date]) IS NOT NULL
        """
    )
    raw = str((rows[0] or {}).get("ym") or "")[:7] if rows else ""
    if len(raw) < 7:
        return None
    try:
        return _month_start(raw)
    except HTTPException:
        return None


def queue_summary(*, through: str, months: int | None = None) -> dict[str, Any]:
    end_m = _month_start(through)
    if months is None:
        earliest = _earliest_month() or _add_months(end_m, -11)
        if earliest > end_m:
            earliest = end_m
        n = min(max(1, _months_between(earliest, end_m)), 120)
    else:
        n = max(1, min(int(months), 120))
    start_m = _add_months(end_m, 1 - n)
    end = _add_months(end_m, 1)
    key = f"cc:{_ym(start_m)}:{_ym(end_m)}:{n}"
    now = time.monotonic()
    if (
        _summary_cache.get("key") == key
        and _summary_cache.get("data")
        and now - float(_summary_cache.get("at") or 0) < _SUMMARY_TTL_SEC
    ):
        return _summary_cache["data"]

    live = _cached_scan(start_m, end)
    store = _load_store()
    saved = store["flags"]
    by_month: dict[str, dict[str, int]] = defaultdict(
        lambda: {"open": 0, "delta": 0, "missing": 0, "unknown": 0}
    )
    for flag in live:
        merged = _merge_resolution(flag, saved.get(flag["id"]))
        if (merged.get("status") or "open") != "open":
            continue
        ym = str(merged.get("ym") or "")[:7]
        if not ym:
            continue
        by_month[ym]["open"] += 1
        kind = str(merged.get("kind") or "")
        if kind in _KINDS:
            by_month[ym][kind] += 1

    rail = []
    cursor = end_m
    for _ in range(n):
        ym = _ym(cursor)
        counts = by_month.get(ym) or {"open": 0, "delta": 0, "missing": 0, "unknown": 0}
        if counts["open"] > 0:
            rail.append({"month": ym, **counts})
        cursor = _add_months(cursor, -1)

    by_year: dict[str, dict[str, Any]] = {}
    years: list[dict[str, Any]] = []
    for row in rail:
        y = row["month"][:4]
        bucket = by_year.get(y)
        if bucket is None:
            bucket = {"year": y, "open": 0, "months_with_open": 0, "months": []}
            by_year[y] = bucket
            years.append(bucket)
        bucket["open"] += row["open"]
        bucket["months_with_open"] += 1
        bucket["months"].append(row)

    # roots snapshot (open only)
    missing_casinos = sorted(
        {
            str(f.get("casino") or "")
            for f in live
            if (_merge_resolution(f, saved.get(f["id"])).get("status") or "open") == "open"
            and f.get("kind") == "missing"
        }
    )
    unknown_cids = sorted(
        {
            int(f["commission_id"])
            for f in live
            if (_merge_resolution(f, saved.get(f["id"])).get("status") or "open") == "open"
            and f.get("kind") == "unknown"
            and f.get("commission_id") is not None
        }
    )

    payload = {
        "source": "live",
        "through": _ym(end_m),
        "from_month": _ym(start_m),
        "months_scanned": n,
        "months_with_open": len(rail),
        "years_with_open": len(years),
        "total_open": sum(r["open"] for r in rail),
        "seat_hard_abs": SEAT_HARD_ABS,
        "property_pass_abs": PROPERTY_PASS_ABS,
        "years": years,
        "months": rail,
        "roots": {
            "casinos_with_missing_profile": missing_casinos,
            "unknown_cids": unknown_cids,
        },
    }
    _summary_cache["key"] = key
    _summary_cache["at"] = now
    _summary_cache["data"] = payload
    return payload


def queue_for_month(
    month: str,
    *,
    status: str = "open",
    kind: str = "all",
) -> dict[str, Any]:
    target = _month_start(month)
    nxt = _add_months(target, 1)
    live = _cached_scan(target, nxt)
    store = _load_store()
    saved = store["flags"]
    all_flags = [_merge_resolution(f, saved.get(f["id"])) for f in live]
    want_status = (status or "open").strip().lower()
    want_kind = (kind or "all").strip().lower()
    merged = all_flags
    if want_status != "all":
        merged = [f for f in merged if (f.get("status") or "open") == want_status]
    if want_kind == "roots":
        merged = [f for f in merged if f.get("kind") in {"missing", "unknown"}]
    elif want_kind in _KINDS:
        merged = [f for f in merged if f.get("kind") == want_kind]
    open_n = sum(1 for f in all_flags if (f.get("status") or "open") == "open")
    kinds = {"delta": 0, "missing": 0, "unknown": 0}
    for f in all_flags:
        if (f.get("status") or "open") != "open":
            continue
        k = str(f.get("kind") or "")
        if k in kinds:
            kinds[k] += 1
    return {
        "source": "live",
        "month": _ym(target),
        "seat_hard_abs": SEAT_HARD_ABS,
        "property_pass_abs": PROPERTY_PASS_ABS,
        "open_count": open_n,
        "kind_counts": kinds,
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
        raise HTTPException(
            status_code=400,
            detail="status must be bill_a, bill_b, needs_root_fix, or amount_due_only",
        )
    text = validate_note(note)
    who = "local"
    if user:
        who = str(user.get("email") or user.get("employee_id") or "paul").strip()
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
    _invalidate_summary()
    return store["flags"][fid]
