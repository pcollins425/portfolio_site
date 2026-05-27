"""Read-only aggregates from [dashboard].[vw_performance_report] (facade over Master_Revenue)."""

from __future__ import annotations

import os
from datetime import date, datetime

from fastapi import APIRouter

from app import mssql

router = APIRouter(prefix="/api", tags=["master-revenue"])

_MV = "[dashboard].[vw_performance_report]"


def _revenue_catalog() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _revenue_query(sql: str, params=None):
    return mssql.query(sql, params=params, database=_revenue_catalog(), load_env=False)


def _as_date(v) -> date | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    return None


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


@router.get("/executive")
def executive():
    periods = _distinct_periods(2)
    if not periods:
        return {"source": "live", "error": "No dated rows in revenue façade view"}

    latest_d = periods[0]
    prev_d = periods[1] if len(periods) > 1 else periods[0]

    def sums(d: date):
        r = _revenue_query(
            f"""
SELECT
    SUM(ISNULL([Coin_in], 0)) AS coin_in,
    SUM(ISNULL([Actual_win], 0)) AS actual_win,
    SUM(ISNULL([Commission], 0)) AS commission
FROM {_MV} AS mr
WHERE CONVERT(date, TRY_CONVERT(datetime, [date])) = %s
""",
            (d,),
        )[0]
        return {
            "coin_in": float(r["coin_in"] or 0),
            "actual_win": float(r["actual_win"] or 0),
            "commission": float(r["commission"] or 0),
        }

    cur, prior = sums(latest_d), sums(prev_d)

    def pct(a: float, b: float) -> float:
        return (a - b) / b if b else 0.0

    bars = _revenue_query(
        f"""
SELECT
    [Casino] AS casino,
    SUM(ISNULL([Commission], 0)) AS commission,
    SUM(ISNULL([Actual_win], 0)) AS actual_win
FROM {_MV} AS mr
WHERE CONVERT(date, TRY_CONVERT(datetime, [date])) = %s
GROUP BY [Casino]
ORDER BY SUM(ISNULL([Commission], 0)) DESC
""",
        (latest_d,),
    )

    bar_out = []
    for b in bars:
        c = str(b["casino"] or "")
        bar_out.append(
            {
                "casino": c.split(" ", 2)[0] if c else "?",
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
def finance_casinos_latest():
    periods = _distinct_periods(1)
    if not periods:
        return {"source": "live", "casinos": []}
    d = periods[0]
    rows = _revenue_query(
        f"""
SELECT
    MIN([Casino]) AS casino,
    AVG(CAST(ISNULL([ADW], 0) AS float)) AS avg_adw,
    AVG(CAST(ISNULL([HouseWPU], 0) AS float)) AS house_wpu
FROM {_MV} AS mr
WHERE CONVERT(date, TRY_CONVERT(datetime, [date])) = %s
GROUP BY [Casino]
ORDER BY MIN([Casino])
""",
        (d,),
    )
    casinos = []
    for r in rows:
        avg_adw = float(r["avg_adw"] or 0)
        hw = float(r["house_wpu"] or 0)
        nm = str(r["casino"] or "")
        casinos.append(
            {
                "casino": nm.split(" ", 1)[0] if nm else "?",
                "avgAdw": round(avg_adw),
                "houseWpu": round(hw),
                "delta": round(avg_adw - hw),
            }
        )
    return {"source": "live", "as_of": d.isoformat(), "casinos": casinos}


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
def performance_themes_top():
    periods = _distinct_periods(1)
    if not periods:
        return {"source": "live", "themes": []}
    d = periods[0]
    rows = _revenue_query(
        f"""
SELECT
    [Theme] AS theme,
    [Cabinet] AS cabinet,
    [Casino] AS casino,
    SUM(ISNULL([Coin_in], 0)) AS coin_in,
    AVG(CAST(ISNULL([WIN_Index], 0) AS float)) AS win_index
FROM {_MV} AS mr
WHERE CONVERT(date, TRY_CONVERT(datetime, [date])) = %s
  AND NULLIF(LTRIM(RTRIM([Theme])), N'') IS NOT NULL
GROUP BY [Theme], [Cabinet], [Casino]
""",
        (d,),
    )
    enriched = sorted(
        [
            (
                float(r["win_index"] or 0),
                {
                    "label": str(r["theme"] or "?")[:22],
                    "subtitle": f"{str(r['casino'] or '').split(' ', 1)[0]} · {str(r['cabinet'] or '')}",
                    "winIndex": round(float(r["win_index"] or 0), 1),
                    "coinIn": float(r["coin_in"] or 0),
                },
            )
            for r in rows
        ],
        key=lambda x: x[0],
        reverse=True,
    )[:40]
    return {"source": "live", "as_of": d.isoformat(), "themes": [x[1] for x in enriched]}
