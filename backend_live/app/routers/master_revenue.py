"""Read-only aggregates from [dashboard].[vw_performance_report] (facade over Master_Revenue)."""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta

from fastapi import APIRouter, HTTPException, Query

from app import mssql

router = APIRouter(prefix="/api", tags=["master-revenue"])

_MV = "[dashboard].[vw_performance_report]"


def _revenue_catalog() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _revenue_query(sql: str, params=None):
    return mssql.query(sql, params=params, database=_revenue_catalog(), load_env=False)


def _revenue_query_many(statements: list[tuple[str, tuple | None]]):
    return mssql.query_many(
        statements,
        database=_revenue_catalog(),
        load_env=False,
    )


def _as_date(v) -> date | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return None


def _distinct_periods(limit: int) -> list[date]:
    lim = max(1, min(int(limit), 120))
    rows = _revenue_query(
        f"""
SELECT DISTINCT TOP ({lim})
    CONVERT(date, TRY_CONVERT(datetime, [date])) AS d
FROM {_MV} AS mr
WHERE TRY_CONVERT(datetime, [date]) IS NOT NULL
ORDER BY CONVERT(date, TRY_CONVERT(datetime, [date])) DESC
"""
    )
    out: list[date] = []
    for r in rows:
        d = _as_date(r.get("d"))
        if d is not None:
            out.append(d)
    return out


def _month_prefix(month: str | None) -> str | None:
    if not month:
        return None
    raw = month.strip()
    if len(raw) < 7:
        raise HTTPException(status_code=400, detail="month must be YYYY-MM or YYYY-MM-DD")
    return raw[:7]


def _resolve_target_period(month: str | None, periods: list[date]) -> tuple[date, date]:
    if not periods:
        raise HTTPException(status_code=404, detail="No dated rows in revenue façade view")

    prefix = _month_prefix(month)
    if prefix:
        for d in periods:
            if d.isoformat()[:7] == prefix:
                idx = periods.index(d)
                prev = periods[idx + 1] if idx + 1 < len(periods) else d
                return d, prev
        raise HTTPException(status_code=404, detail=f"No data for month {prefix}")

    latest = periods[0]
    prev = periods[1] if len(periods) > 1 else periods[0]
    return latest, prev


@router.get("/health")
def health():
    catalog = _revenue_catalog()
    n = None
    ok = False
    try:
        row = _revenue_query(f"SELECT COUNT(*) AS n FROM {_MV}")[0]
        n = int(row["n"])
        ok = True
    except Exception:
        pass
    ext = os.environ.get("MSSQL_EXTERNAL") or os.environ.get("MSSQL_HOST")
    return {
        "ok": ok,
        "database": catalog,
        "facade_object": "dashboard.vw_performance_report",
        "host": ext,
        "master_revenue_rows": n,
    }


@router.get("/periods")
def periods(limit: int = Query(36, ge=1, le=120)):
    rows = _distinct_periods(limit)
    return {"source": "live", "periods": [d.isoformat() for d in rows]}


@router.get("/executive")
def executive(month: str | None = Query(None, description="YYYY-MM or YYYY-MM-DD month-end slice")):
    period_rows = _distinct_periods(24)
    try:
        latest_d, prev_d = _resolve_target_period(month, period_rows)
    except HTTPException as exc:
        if exc.status_code == 404:
            return {"source": "live", "error": str(exc.detail)}
        raise

    sum_sql = f"""
SELECT
    SUM(ISNULL([Coin_in], 0)) AS coin_in,
    SUM(ISNULL([Actual_win], 0)) AS actual_win,
    SUM(ISNULL([Commission], 0)) AS commission
FROM {_MV} AS mr
WHERE CONVERT(date, TRY_CONVERT(datetime, [date])) = %s
"""
    bars_sql = f"""
SELECT
    RTRIM([Casino]) AS casino,
    SUM(ISNULL([Commission], 0)) AS commission,
    SUM(ISNULL([Actual_win], 0)) AS actual_win
FROM {_MV} AS mr
WHERE CONVERT(date, TRY_CONVERT(datetime, [date])) = %s
GROUP BY RTRIM([Casino])
ORDER BY SUM(ISNULL([Commission], 0)) DESC
"""

    (cur_rows, prior_rows, bar_rows) = _revenue_query_many(
        [
            (sum_sql, (latest_d,)),
            (sum_sql, (prev_d,)),
            (bars_sql, (latest_d,)),
        ]
    )

    cur = {
        "coin_in": float(cur_rows[0]["coin_in"] or 0),
        "actual_win": float(cur_rows[0]["actual_win"] or 0),
        "commission": float(cur_rows[0]["commission"] or 0),
    }
    prior = {
        "coin_in": float(prior_rows[0]["coin_in"] or 0),
        "actual_win": float(prior_rows[0]["actual_win"] or 0),
        "commission": float(prior_rows[0]["commission"] or 0),
    }

    def pct(a: float, b: float) -> float:
        return (a - b) / b if b else 0.0

    bar_out = []
    for b in bar_rows:
        bar_out.append(
            {
                "casino": str(b["casino"] or "").strip() or "?",
                "commission": float(b["commission"] or 0),
                "actual_win": float(b["actual_win"] or 0),
            }
        )

    return {
        "source": "live",
        "latest": latest_d.isoformat(),
        "prev": prev_d.isoformat(),
        "coinIn": cur["coin_in"],
        "coinInMom": pct(cur["coin_in"], prior["coin_in"]),
        "actualWin": cur["actual_win"],
        "actualMom": pct(cur["actual_win"], prior["actual_win"]),
        "commission": cur["commission"],
        "commissionMom": pct(cur["commission"], prior["commission"]),
        "bars": bar_out,
    }


@router.get("/analyst/trends")
def analyst_trends():
    rows = _revenue_query(
        f"""
SELECT
    CONVERT(date, TRY_CONVERT(datetime, [date])) AS d,
    SUM(ISNULL([Actual_win], 0)) AS actual_win,
    SUM(ISNULL([Theo_win], 0)) AS theo_win
FROM {_MV} AS mr
WHERE TRY_CONVERT(datetime, [date]) IS NOT NULL
GROUP BY CONVERT(date, TRY_CONVERT(datetime, [date]))
ORDER BY d DESC
"""
    )
    sliced = rows[:24][::-1]
    out = []
    for row in sliced:
        d = _as_date(row.get("d"))
        month_label = d.isoformat()[:7] if d else "?-?"
        aw = float(row["actual_win"] or 0)
        tw = float(row["theo_win"] or 0)
        var = (aw - tw) / tw if tw else 0.0
        out.append({"month": month_label, "actualWin": aw, "theoWin": tw, "variance": var})
    return {"source": "live", "trends": out}


@router.get("/analyst/sanity")
def analyst_sanity():
    return {"source": "live", "flags": []}


@router.get("/finance/casinos-latest")
def finance_casinos_latest(month: str | None = Query(None, description="YYYY-MM or YYYY-MM-DD month-end slice")):
    periods = _distinct_periods(24)
    try:
        latest_d, _ = _resolve_target_period(month, periods)
    except HTTPException as exc:
        if exc.status_code == 404:
            return {"source": "live", "casinos": []}
        raise

    rows = _revenue_query(
        f"""
SELECT
    RTRIM([Casino]) AS casino,
    AVG(CAST(ISNULL([ADW], 0) AS float)) AS avg_adw,
    AVG(CAST(ISNULL([HouseWPU], 0) AS float)) AS house_wpu
FROM {_MV} AS mr
WHERE CONVERT(date, TRY_CONVERT(datetime, [date])) = %s
GROUP BY RTRIM([Casino])
ORDER BY RTRIM([Casino])
""",
        (latest_d,),
    )
    casinos = []
    for r in rows:
        avg_adw = float(r["avg_adw"] or 0)
        hw = float(r["house_wpu"] or 0)
        casinos.append(
            {
                "casino": str(r["casino"] or "").strip() or "?",
                "avgAdw": round(avg_adw),
                "houseWpu": round(hw),
                "delta": round(avg_adw - hw),
            }
        )
    return {"source": "live", "as_of": latest_d.isoformat(), "casinos": casinos}


def _month_bounds(ym: str) -> tuple[date, date]:
    y, m = int(ym[:4]), int(ym[5:7])
    start = date(y, m, 1)
    if m == 12:
        end = date(y + 1, 1, 1) - timedelta(days=1)
    else:
        end = date(y, m + 1, 1) - timedelta(days=1)
    return start, end


def _shift_month(ym: str, delta: int) -> str:
    y, m = int(ym[:4]), int(ym[5:7])
    total = y * 12 + (m - 1) + delta
    return f"{total // 12:04d}-{total % 12 + 1:02d}"


def _month_span(from_ym: str, to_ym: str) -> list[str]:
    out = []
    cur = from_ym
    while cur <= to_ym:
        out.append(cur)
        cur = _shift_month(cur, 1)
    return out


# Sold sentinel casino — never expected to invoice.
_SOLD_CASINO_ID = "CT-00907"


@router.get("/finance/overview")
def finance_overview(
    from_month: str = Query(..., alias="from", description="Processing month range start (YYYY-MM)"),
    to_month: str = Query(..., alias="to", description="Processing month range end (YYYY-MM)"),
):
    """Billing coverage: expected serials on floor vs invoiced MR entries, commission, missing reports.

    Grain note: invoiced counts are MR *entries* (convert splits = 2 rows per serial);
    expected counts are *distinct serials* active during the processing month (interim
    until migration dating supports entry-grain expectations).
    """
    f = _month_prefix(from_month)
    t = _month_prefix(to_month)
    if not f or not t:
        raise HTTPException(status_code=400, detail="from and to are required (YYYY-MM)")
    if f > t:
        f, t = t, f
    months = _month_span(f, t)
    if len(months) > 36:
        raise HTTPException(status_code=400, detail="range too wide (max 36 months)")

    mom_ym = _shift_month(t, -1)
    yoy_ym = _shift_month(t, -12)
    ext_months = sorted(set(months + [mom_ym, yoy_ym]))

    window_start = _month_bounds(ext_months[0])[0]
    window_end = _month_bounds(ext_months[-1])[1]

    # --- MR side (dashboard profile): invoiced entries/serials + commission + last report ---
    mr_sql = f"""
SELECT
    RTRIM([Casino]) AS casino,
    CONVERT(date, TRY_CONVERT(datetime, [date])) AS d,
    COUNT(*) AS entries,
    COUNT(DISTINCT [Serial_number]) AS serials,
    SUM(ISNULL([Commission], 0)) AS commission
FROM {_MV} AS mr
WHERE TRY_CONVERT(datetime, [date]) IS NOT NULL
  AND CONVERT(date, TRY_CONVERT(datetime, [date])) BETWEEN %s AND %s
GROUP BY RTRIM([Casino]), CONVERT(date, TRY_CONVERT(datetime, [date]))
"""
    last_report_sql = f"""
SELECT RTRIM([Casino]) AS casino, MAX(CONVERT(date, TRY_CONVERT(datetime, [date]))) AS last_report
FROM {_MV} AS mr
WHERE TRY_CONVERT(datetime, [date]) IS NOT NULL
GROUP BY RTRIM([Casino])
"""
    mr_rows, last_rows = _revenue_query_many(
        [
            (mr_sql, (window_start, window_end)),
            (last_report_sql, None),
        ]
    )

    # --- Floor side (field profile): distinct serials active during each month ---
    values_rows = ", ".join(["(%s, %s)"] * len(ext_months))
    expected_params: list = []
    for ym in ext_months:
        ms, me = _month_bounds(ym)
        expected_params.extend([ms, me])
    expected_sql = f"""
SELECT
    c.casino_short AS casino,
    m.ms AS month_start,
    COUNT(DISTINCT sm.asset_id) AS expected_serials
FROM (VALUES {values_rows}) AS m(ms, me)
JOIN inventory.slot_master_migration AS sm
    ON (sm.date_instl IS NULL OR CONVERT(date, sm.date_instl) <= CONVERT(date, m.me))
   AND (sm.rmvl_date IS NULL OR CONVERT(date, sm.rmvl_date) >= CONVERT(date, m.ms))
JOIN clients.casinos AS c ON c.reference_key = sm.casino_id
WHERE sm.casino_id <> %s
GROUP BY c.casino_short, m.ms
"""
    expected_rows = mssql.query(
        expected_sql,
        params=tuple(expected_params) + (_SOLD_CASINO_ID,),
        database=_revenue_catalog(),
        profile="field",
        load_env=False,
    )

    # --- Aggregate in Python, keyed (casino, YYYY-MM) ---
    def _ym(v) -> str | None:
        d = _as_date(v)
        return d.isoformat()[:7] if d else None

    mr_by_key: dict[tuple[str, str], dict] = {}
    for r in mr_rows:
        ym = _ym(r.get("d"))
        casino = str(r.get("casino") or "").strip()
        if not ym or not casino:
            continue
        key = (casino, ym)
        agg = mr_by_key.setdefault(key, {"entries": 0, "serials": 0, "commission": 0.0})
        agg["entries"] += int(r.get("entries") or 0)
        agg["serials"] += int(r.get("serials") or 0)
        agg["commission"] += float(r.get("commission") or 0)

    expected_by_key: dict[tuple[str, str], int] = {}
    for r in expected_rows:
        ym = _ym(r.get("month_start"))
        casino = str(r.get("casino") or "").strip()
        if not ym or not casino:
            continue
        expected_by_key[(casino, ym)] = int(r.get("expected_serials") or 0)

    last_report: dict[str, str] = {}
    for r in last_rows:
        casino = str(r.get("casino") or "").strip()
        d = _as_date(r.get("last_report"))
        if casino and d:
            last_report[casino] = d.isoformat()

    all_casinos = sorted(
        {c for (c, ym) in mr_by_key if ym in months} | {c for (c, ym) in expected_by_key if ym in months}
    )

    def month_totals(ym: str) -> dict:
        expected = sum(v for (c, m), v in expected_by_key.items() if m == ym)
        entries = sum(v["entries"] for (c, m), v in mr_by_key.items() if m == ym)
        serials = sum(v["serials"] for (c, m), v in mr_by_key.items() if m == ym)
        commission = sum(v["commission"] for (c, m), v in mr_by_key.items() if m == ym)
        exp_casinos = {c for (c, m), v in expected_by_key.items() if m == ym and v > 0}
        rep_casinos = {c for (c, m), v in mr_by_key.items() if m == ym and v["entries"] > 0}
        return {
            "month": ym,
            "expected_serials": expected,
            "invoiced_entries": entries,
            "invoiced_serials": serials,
            "commission": commission,
            "casinos_expected": len(exp_casinos),
            "casinos_reported": len(rep_casinos),
            "casinos_missing": len(exp_casinos - rep_casinos),
        }

    monthly = [month_totals(ym) for ym in months]
    focus = month_totals(t)
    mom = month_totals(mom_ym)
    yoy = month_totals(yoy_ym)

    def pct(a: float, b: float) -> float:
        return (a - b) / b if b else 0.0

    kpis = {
        **focus,
        "live_assets_mom": pct(focus["expected_serials"], mom["expected_serials"]),
        "live_assets_yoy": pct(focus["expected_serials"], yoy["expected_serials"]),
        "commission_mom": pct(focus["commission"], mom["commission"]),
        "commission_yoy": pct(focus["commission"], yoy["commission"]),
        "mom_month": mom_ym,
        "yoy_month": yoy_ym,
    }

    casinos_out = []
    for casino in all_casinos:
        exp_focus = expected_by_key.get((casino, t), 0)
        mr_focus = mr_by_key.get((casino, t), {"entries": 0, "serials": 0, "commission": 0.0})
        missing = [
            ym
            for ym in months
            if expected_by_key.get((casino, ym), 0) > 0
            and mr_by_key.get((casino, ym), {}).get("entries", 0) == 0
        ]
        casinos_out.append(
            {
                "casino": casino,
                "expected_serials": exp_focus,
                "invoiced_entries": mr_focus["entries"],
                "invoiced_serials": mr_focus["serials"],
                "gap": mr_focus["entries"] - exp_focus,
                "commission": mr_focus["commission"],
                "last_report": last_report.get(casino),
                "missing_months": missing,
            }
        )
    casinos_out.sort(key=lambda r: (-len(r["missing_months"]), r["casino"]))

    return {
        "source": "live",
        "from": f,
        "to": t,
        "months": months,
        "kpis": kpis,
        "monthly": monthly,
        "casinos": casinos_out,
    }


@router.get("/finance/commission-intensity")
def finance_commission_intensity():
    rows = _revenue_query(
        f"""
SELECT
    CONVERT(date, TRY_CONVERT(datetime, [date])) AS d,
    SUM(ISNULL([Commission], 0)) AS commission,
    SUM(ISNULL([Actual_win], 0)) AS actual_win
FROM {_MV} AS mr
WHERE TRY_CONVERT(datetime, [date]) IS NOT NULL
GROUP BY CONVERT(date, TRY_CONVERT(datetime, [date]))
ORDER BY d DESC
"""
    )
    sliced = rows[:36][::-1]
    ratios = []
    for row in sliced:
        d = _as_date(row.get("d"))
        aw = float(row["actual_win"] or 0)
        cm = float(row["commission"] or 0)
        ratios.append({"month": d.isoformat()[:7] if d else "?-?", "ratio": cm / aw if aw else None})
    return {"source": "live", "ratios": ratios}


@router.get("/performance/themes-top")
def performance_themes_top(month: str | None = Query(None, description="YYYY-MM or YYYY-MM-DD month-end slice")):
    periods = _distinct_periods(24)
    try:
        latest_d, _ = _resolve_target_period(month, periods)
    except HTTPException as exc:
        if exc.status_code == 404:
            return {"source": "live", "themes": []}
        raise

    rows = _revenue_query(
        f"""
SELECT
    [Theme] AS theme,
    [Cabinet] AS cabinet,
    RTRIM([Casino]) AS casino,
    SUM(ISNULL([Coin_in], 0)) AS coin_in,
    AVG(CAST(ISNULL([WIN_Index], 0) AS float)) AS win_index
FROM {_MV} AS mr
WHERE CONVERT(date, TRY_CONVERT(datetime, [date])) = %s
  AND NULLIF(LTRIM(RTRIM([Theme])), N'') IS NOT NULL
GROUP BY [Theme], [Cabinet], RTRIM([Casino])
""",
        (latest_d,),
    )
    enriched = sorted(
        [
            (
                float(r["win_index"] or 0),
                {
                    "label": str(r["theme"] or "?")[:22],
                    "subtitle": f"{str(r['casino'] or '').strip()} · {str(r['cabinet'] or '')}",
                    "winIndex": round(float(r["win_index"] or 0), 1),
                    "coinIn": float(r["coin_in"] or 0),
                },
            )
            for r in rows
        ],
        key=lambda x: x[0],
        reverse=True,
    )[:40]
    return {"source": "live", "as_of": latest_d.isoformat(), "themes": [x[1] for x in enriched]}
