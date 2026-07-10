"""Read-only aggregates from [dashboard].[vw_performance_report] (facade over Master_Revenue)."""

from __future__ import annotations

import os
from datetime import date, datetime

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
