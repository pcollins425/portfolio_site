"""Read-only aggregates from [dashboard].[vw_performance_report] (facade over Master_Revenue)."""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app import analyst_queue as aq
from app import mssql
from app.auth_deps import require_demo_user

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
    if isinstance(v, str):
        raw = v.strip()
        if not raw:
            return None
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%m/%d/%Y"):
            try:
                return datetime.strptime(raw[:19], fmt).date()
            except ValueError:
                continue
    return None


def _ym_label(v) -> str | None:
    d = _as_date(v)
    return d.isoformat()[:7] if d else None


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
    """Deprecated placeholder — use GET /api/analyst/queue."""
    return {"source": "live", "flags": [], "deprecated": True, "use": "/api/analyst/queue"}


class _AnalystResolveBody(BaseModel):
    id: str = Field(min_length=3)
    status: str
    note: str


@router.get("/analyst/ping")
def analyst_ping():
    """No-auth probe: if this 404s, the image does not have the queue commit."""
    return {"ok": True, "queue": "/api/analyst/queue"}


@router.get("/analyst/summary")
def analyst_summary(
    through: str | None = Query(None, description="YYYY-MM latest month to include"),
    months: int | None = Query(None, ge=1, le=120, description="Omit to scan all façade months"),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    aq.assert_paul(user)
    if not through or len(through.strip()) < 7:
        periods = _distinct_periods(1)
        if not periods:
            raise HTTPException(status_code=404, detail="No dated rows in revenue façade view")
        through = periods[0].isoformat()[:7]
    try:
        return aq.queue_summary(through=through.strip()[:7], months=months)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"analyst summary failed: {exc}") from exc


@router.get("/analyst/queue")
def analyst_queue(
    month: str | None = Query(None, description="YYYY-MM focus month"),
    status: str = Query("open"),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    aq.assert_paul(user)
    if not month or len(month.strip()) < 7:
        raise HTTPException(status_code=400, detail="month=YYYY-MM required")
    try:
        return aq.queue_for_month(month.strip()[:7], status=status)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"analyst queue scan failed: {exc}") from exc


@router.post("/analyst/queue/resolve")
def analyst_queue_resolve(
    body: _AnalystResolveBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    aq.assert_paul(user)
    saved = aq.resolve_flag(body.id, status=body.status, note=body.note, user=user)
    return {"ok": True, "id": body.id, **saved}


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
    """Billing coverage: expected migration rows vs invoiced MR entries by SMM key.

    - **Invoiced** = MR row count where ``slot_master_id`` is populated (one entry per MR line).
    - **Expected** = ``slot_master_migration`` rows active during the processing month
      (``golive001`` with ``date_instl`` fallback / ``rmvl_date`` window), compared on
      ``slot_master_id`` ↔ ``reference_key``. Billing starts at go-live when set; otherwise
      install date. Convert predecessors close via another row's ``lastconver``
      (no ``rmvl_date`` on theme change); earliest successor convert before month start
      excludes the row (convert month still counts).
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

    mr_keys_sql = f"""
SELECT
    COALESCE(NULLIF(RTRIM(c.casino_short), N''), RTRIM(mr.[Casino])) AS casino,
    CONVERT(date, TRY_CONVERT(datetime, mr.[date])) AS d,
    LTRIM(RTRIM(mr.[slot_master_id])) AS smm_key
FROM {_MV} AS mr
LEFT JOIN inventory.slot_master_migration AS sm
    ON sm.reference_key = LTRIM(RTRIM(mr.[slot_master_id]))
LEFT JOIN clients.casinos AS c ON c.reference_key = sm.casino_id
WHERE TRY_CONVERT(datetime, mr.[date]) IS NOT NULL
  AND CONVERT(date, TRY_CONVERT(datetime, mr.[date])) BETWEEN %s AND %s
  AND NULLIF(LTRIM(RTRIM(mr.[slot_master_id])), N'') IS NOT NULL
"""
    mr_commission_sql = f"""
SELECT
    RTRIM([Casino]) AS casino,
    CONVERT(date, TRY_CONVERT(datetime, [date])) AS d,
    COUNT(*) AS entries,
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

    values_rows = ", ".join(["(%s, %s)"] * len(ext_months))
    expected_params: list = []
    for ym in ext_months:
        ms, me = _month_bounds(ym)
        expected_params.extend([ms, me])
    expected_keys_sql = f"""
SELECT
    COALESCE(NULLIF(RTRIM(c.casino_short), N''), RTRIM(c.casino_name)) AS casino,
    m.ms AS month_start,
    sm.reference_key AS smm_key
FROM (VALUES {values_rows}) AS m(ms, me)
JOIN inventory.slot_master_migration AS sm
    ON COALESCE(sm.golive001, sm.date_instl) IS NOT NULL
   AND CONVERT(date, COALESCE(sm.golive001, sm.date_instl)) <= CONVERT(date, m.me)
   AND (sm.rmvl_date IS NULL OR CONVERT(date, sm.rmvl_date) >= CONVERT(date, m.ms))
JOIN clients.casinos AS c ON c.reference_key = sm.casino_id
WHERE sm.casino_id <> %s
  /* Convert close-out: earliest successor lastconver after floor start ends this theme row
     before the processing month (convert month still counts). */
  AND NOT EXISTS (
    SELECT 1
    FROM inventory.slot_master_migration AS succ
    WHERE succ.asset_id = sm.asset_id
      AND succ.casino_id = sm.casino_id
      AND succ.reference_key <> sm.reference_key
      AND succ.lastconver IS NOT NULL
      AND CONVERT(date, succ.lastconver) > CONVERT(date, COALESCE(sm.lastconver, sm.golive001, sm.date_instl))
      AND CONVERT(date, succ.lastconver) < CONVERT(date, m.ms)
  )
"""

    mr_comm_rows, last_rows = _revenue_query_many(
        [
            (mr_commission_sql, (window_start, window_end)),
            (last_report_sql, None),
        ]
    )
    # MR + migration join requires field profile (cross-object grants).
    mr_key_rows = mssql.query(
        mr_keys_sql,
        params=(window_start, window_end),
        database=_revenue_catalog(),
        profile="field",
        load_env=False,
    )
    expected_key_rows = mssql.query(
        expected_keys_sql,
        params=tuple(expected_params) + (_SOLD_CASINO_ID,),
        database=_revenue_catalog(),
        profile="field",
        load_env=False,
    )

    def _ym(v) -> str | None:
        return _ym_label(v)

    # Per (casino, month): expected / invoiced SMM key sets + row counts
    expected_sets: dict[tuple[str, str], set[str]] = {}
    expected_counts: dict[tuple[str, str], int] = {}
    invoiced_sets: dict[tuple[str, str], set[str]] = {}
    invoiced_entries: dict[tuple[str, str], int] = {}
    commission_by_key: dict[tuple[str, str], float] = {}

    for r in expected_key_rows:
        ym = _ym(r.get("month_start"))
        casino = str(r.get("casino") or "").strip()
        key = str(r.get("smm_key") or "").strip()
        if not ym or not casino or not key:
            continue
        cm_key = (casino, ym)
        expected_sets.setdefault(cm_key, set()).add(key)
        expected_counts[cm_key] = expected_counts.get(cm_key, 0) + 1

    for r in mr_key_rows:
        ym = _ym(r.get("d"))
        casino = str(r.get("casino") or "").strip()
        key = str(r.get("smm_key") or "").strip()
        if not ym or not casino or not key:
            continue
        cm_key = (casino, ym)
        invoiced_sets.setdefault(cm_key, set()).add(key)
        invoiced_entries[cm_key] = invoiced_entries.get(cm_key, 0) + 1

    for r in mr_comm_rows:
        ym = _ym(r.get("d"))
        casino = str(r.get("casino") or "").strip()
        if not ym or not casino:
            continue
        commission_by_key[(casino, ym)] = float(r.get("commission") or 0)

    last_report: dict[str, str] = {}
    for r in last_rows:
        casino = str(r.get("casino") or "").strip()
        d = _as_date(r.get("last_report"))
        if casino and d:
            last_report[casino] = d.isoformat()

    all_casinos = sorted(
        {c for (c, ym) in expected_sets if ym in months}
        | {c for (c, ym) in invoiced_sets if ym in months}
    )

    def month_totals(ym: str) -> dict:
        exp_keys: set[str] = set()
        inv_keys: set[str] = set()
        expected = 0
        entries = 0
        commission = 0.0
        exp_casinos: set[str] = set()
        rep_casinos: set[str] = set()

        for (casino, m), keys in expected_sets.items():
            if m != ym:
                continue
            exp_keys |= keys
            expected += expected_counts.get((casino, m), len(keys))
            if keys:
                exp_casinos.add(casino)
        for (casino, m), keys in invoiced_sets.items():
            if m != ym:
                continue
            inv_keys |= keys
            entries += invoiced_entries.get((casino, m), 0)
            if keys:
                rep_casinos.add(casino)
        for (casino, m), cm in commission_by_key.items():
            if m == ym:
                commission += cm

        return {
            "month": ym,
            "expected_entries": expected,
            "invoiced_entries": entries,
            "invoiced_keys": len(inv_keys),
            "uninvoiced_keys": len(exp_keys - inv_keys),
            "unexpected_keys": len(inv_keys - exp_keys),
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
        "expected_entries_mom": pct(focus["expected_entries"], mom["expected_entries"]),
        "expected_entries_yoy": pct(focus["expected_entries"], yoy["expected_entries"]),
        "commission_mom": pct(focus["commission"], mom["commission"]),
        "commission_yoy": pct(focus["commission"], yoy["commission"]),
        "mom_month": mom_ym,
        "yoy_month": yoy_ym,
    }

    casinos_out = []
    for casino in all_casinos:
        exp_set = expected_sets.get((casino, t), set())
        inv_set = invoiced_sets.get((casino, t), set())
        expected = expected_counts.get((casino, t), len(exp_set))
        entries = invoiced_entries.get((casino, t), 0)
        missing_months = [
            ym
            for ym in months
            if expected_sets.get((casino, ym), set())
            and not invoiced_sets.get((casino, ym), set())
        ]
        casinos_out.append(
            {
                "casino": casino,
                "expected_entries": expected,
                "invoiced_entries": entries,
                "invoiced_keys": len(inv_set),
                "uninvoiced_keys": len(exp_set - inv_set),
                "unexpected_keys": len(inv_set - exp_set),
                "gap": entries - expected,
                "commission": commission_by_key.get((casino, t), 0.0),
                "last_report": last_report.get(casino),
                "missing_months": missing_months,
            }
        )
    casinos_out.sort(key=lambda r: (-r["uninvoiced_keys"], -len(r["missing_months"]), r["casino"]))

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
