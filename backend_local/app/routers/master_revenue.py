"""Read-only aggregates from [dashboard].[vw_performance_report] (facade over Master_Revenue)."""

from __future__ import annotations

import os
from datetime import date, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app import mssql
from app.commission_rules import parse_rules, reporting_waived

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
    [date] AS d
FROM {_MV} AS mr
WHERE [date] IS NOT NULL
ORDER BY [date] DESC
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
    """Executive pulse: revenue KPIs + trailing-12 ops series (no casino bars)."""
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
WHERE [date] = %s
"""
    (cur_rows, prior_rows) = _revenue_query_many(
        [
            (sum_sql, (latest_d,)),
            (sum_sql, (prev_d,)),
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

    window_months = 12
    month_ends = _trailing_month_ends(latest_d, window_months)
    series, series_source = _executive_ops_series_prefer_snapshot(month_ends)

    return {
        "source": "live",
        "series_source": series_source,
        "latest": latest_d.isoformat(),
        "prev": prev_d.isoformat(),
        "window_months": window_months,
        "coinIn": cur["coin_in"],
        "coinInMom": pct(cur["coin_in"], prior["coin_in"]),
        "actualWin": cur["actual_win"],
        "actualMom": pct(cur["actual_win"], prior["actual_win"]),
        "commission": cur["commission"],
        "commissionMom": pct(cur["commission"], prior["commission"]),
        "series": series,
    }


def _trailing_month_ends(end: date, n: int) -> list[date]:
    """Ascending list of month-end dates ending at ``end`` (inclusive)."""
    ym = end.isoformat()[:7]
    out: list[date] = []
    for i in range(n - 1, -1, -1):
        label = _shift_month(ym, -i)
        out.append(_month_bounds(label)[1])
    return out


def _app_query(sql: str, params=None):
    return mssql.query(
        sql,
        params=params,
        database=_revenue_catalog(),
        profile="field",
        load_env=False,
    )


def _executive_ops_series_prefer_snapshot(
    month_ends: list[date],
) -> tuple[list[dict[str, Any]], str]:
    """Prefer finance.executive_ops_month; fall back to live compute if incomplete."""
    if not month_ends:
        return [], "empty"
    try:
        rows = mssql.query(
            """
            SELECT
                month_end,
                projects_open,
                projects_closed,
                deals_created,
                deals_won,
                deals_lost,
                machines,
                machines_delta,
                footprint_converts,
                footprint_swaps,
                footprint_changed,
                footprint_pct,
                leased_clients,
                reporting_reported,
                reporting_expected,
                reporting_pct
            FROM finance.executive_ops_month
            WHERE month_end >= %s AND month_end <= %s
            """,
            params=(month_ends[0], month_ends[-1]),
            database=_revenue_catalog(),
            profile="dashboard",
            load_env=False,
        )
        by_me = {_as_date(r.get("month_end")): r for r in rows}
        if all(me in by_me for me in month_ends):
            series: list[dict[str, Any]] = []
            for me in month_ends:
                r = by_me[me]
                machines = int(r.get("machines") or 0)
                changed = int(r.get("footprint_changed") or 0)
                expected = int(r.get("reporting_expected") or 0)
                reported = int(r.get("reporting_reported") or 0)
                series.append(
                    {
                        "month": me.isoformat(),
                        "projects": {
                            "open": int(r.get("projects_open") or 0),
                            "closed": int(r.get("projects_closed") or 0),
                        },
                        "deals": {
                            "created": int(r.get("deals_created") or 0),
                            "won": int(r.get("deals_won") or 0),
                            "closed": int(r.get("deals_lost") or 0),
                        },
                        "placements": {
                            "machines": machines,
                            "delta": int(r.get("machines_delta") or 0),
                        },
                        "footprint": {
                            "changed": changed,
                            "converts": int(r.get("footprint_converts") or 0),
                            "swaps": int(r.get("footprint_swaps") or 0),
                            "active": machines,
                            "pct": float(r.get("footprint_pct") or 0),
                        },
                        "leased_clients": int(r.get("leased_clients") or 0),
                        "reporting": {
                            "reported": reported,
                            "expected": expected,
                            "pct": float(r.get("reporting_pct") or 0),
                        },
                    }
                )
            return series, "snapshot"
    except Exception:
        pass
    return _executive_ops_series(month_ends), "live"


_EXEC_SOLD_CASINO_ID = "CT-00907"
_EXEC_IMS_ERA_ACTIONS = frozenset(
    {
        "MOVE",
        "UPGRADE",
        "RECONFIG",
        "RECONFIGURE",
        "RECONFIGURATION",
        "CONFIG",
        "CONFIG CHANGE",
        "CONFIG_CHANGE",
    }
)


def _exec_norm_action(v: object) -> str:
    return str(v or "").strip().upper()


def _exec_is_non_playable(row: dict[str, Any]) -> bool:
    text = " ".join(
        [
            str(row.get("asset_no") or ""),
            str(row.get("cabinet_type") or ""),
            str(row.get("machine_type") or ""),
            str(row.get("cabinet_name") or ""),
            str(row.get("theme_name") or ""),
            str(row.get("serial_number") or ""),
        ]
    ).lower()
    return any(tok in text for tok in ("center", "sign", "controller", "server"))


def _exec_effective_from(row: dict[str, Any]) -> date | None:
    action = _exec_norm_action(row.get("action"))
    lastconver = _as_date(row.get("lastconver"))
    golive = _as_date(row.get("golive001"))
    instl = _as_date(row.get("date_instl"))
    ims_start = _as_date(row.get("project_start"))

    if action == "CONVERT":
        return lastconver
    if action in _EXEC_IMS_ERA_ACTIONS:
        if ims_start is not None:
            return ims_start
        if action == "UPGRADE" and lastconver is not None:
            return lastconver
        return None
    if action in ("", "INSTALL"):
        return golive or instl
    if ims_start is not None:
        return ims_start
    if lastconver is not None:
        return lastconver
    return golive or instl


def _exec_stint_era(row: dict[str, Any]) -> date | None:
    action = _exec_norm_action(row.get("action"))
    if action in ("CONVERT", "UPGRADE"):
        return _as_date(row.get("lastconver")) or (
            _as_date(row.get("project_start")) if action == "UPGRADE" else None
        )
    if action == "MOVE":
        return _as_date(row.get("project_start"))
    return (
        _as_date(row.get("lastconver"))
        or _as_date(row.get("golive001"))
        or _as_date(row.get("date_instl"))
    )


def _exec_upgrade_era(row: dict[str, Any]) -> date | None:
    return _as_date(row.get("lastconver")) or _as_date(row.get("project_start"))


def _exec_logic_suppress(
    row: dict[str, Any],
    siblings: list[dict[str, Any]],
    *,
    month_start: date,
    as_of: date,
) -> bool:
    """True if row is suppressed by Finance-style convert/MOVE/UPGRADE close-out."""
    action = _exec_norm_action(row.get("action"))
    ref = str(row.get("reference_key") or "")
    era = _exec_stint_era(row)
    lc_self = _as_date(row.get("lastconver"))

    for s in siblings:
        if str(s.get("reference_key") or "") == ref:
            continue
        succ_lc = _as_date(s.get("lastconver"))
        if succ_lc is None or era is None:
            continue
        if succ_lc > era and succ_lc < month_start:
            return True

    if action == "MOVE":
        ps = _as_date(row.get("project_start"))
        if ps is None or ps > as_of:
            return True

    for s in siblings:
        if str(s.get("reference_key") or "") == ref:
            continue
        if _exec_norm_action(s.get("action")) != "MOVE":
            continue
        mv_start = _as_date(s.get("project_start"))
        if mv_start is None or mv_start > as_of:
            continue
        if action not in ("MOVE", "UPGRADE", "CONVERT"):
            if lc_self is None or lc_self <= mv_start:
                return True
        elif action in ("CONVERT", "UPGRADE"):
            sm_start = lc_self if action == "CONVERT" else _exec_upgrade_era(row)
            if sm_start is not None and sm_start < mv_start:
                return True
        elif action == "MOVE" and era is not None:
            if era < mv_start or (
                not bool(row.get("is_active"))
                and bool(s.get("is_active"))
                and era <= mv_start
            ):
                return True

    if action != "CONVERT":
        for s in siblings:
            if str(s.get("reference_key") or "") == ref:
                continue
            if _exec_norm_action(s.get("action")) != "UPGRADE":
                continue
            upg_era = _exec_upgrade_era(s)
            if upg_era is None or upg_era > as_of:
                continue
            upg_rmvl = _as_date(s.get("rmvl_date"))
            if upg_rmvl is not None and upg_rmvl < month_start:
                continue
            if action not in ("MOVE", "UPGRADE", "CONVERT"):
                if lc_self is not None and not (lc_self < upg_era):
                    continue
                inst = _as_date(row.get("golive001")) or _as_date(row.get("date_instl"))
                if lc_self is None and inst is not None and not (inst < upg_era):
                    continue
                return True
            if action in ("MOVE", "UPGRADE") and era is not None and era < upg_era:
                return True
    return False


def _exec_fetch_smm_floor_rows() -> list[dict[str, Any]]:
    """One fetch of SMM history for EOD floor counts (siblings needed for close-out)."""
    try:
        return _app_query(
            f"""
            SELECT
                m.reference_key,
                m.index_key,
                m.asset_id,
                m.casino_id,
                m.project_id,
                m.action,
                m.is_active,
                m.asset_no,
                m.date_instl,
                m.golive001,
                m.lastconver,
                m.rmvl_date,
                a.serial_number,
                a.cabinet_type,
                a.machine_type,
                cab.cabinet_name,
                t.theme_name,
                i.start_date AS project_start
            FROM inventory.slot_master_migration AS m
            INNER JOIN inventory.assets AS a ON a.reference_key = m.asset_id
            LEFT JOIN vendors.cabinets AS cab ON cab.reference_key = a.cabinet_id
            LEFT JOIN vendors.themes AS t ON t.reference_key = m.theme_id
            LEFT JOIN projects.ims AS i ON i.reference_key = m.project_id
            WHERE m.casino_id <> N'{_EXEC_SOLD_CASINO_ID}'
              AND m.casino_id IS NOT NULL
              AND LTRIM(RTRIM(m.casino_id)) <> N''
            """
        )
    except Exception:
        return []


def _exec_floor_counts_by_month(
    month_ends: list[date], rows: list[dict[str, Any]]
) -> tuple[dict[str, int], dict[str, int]]:
    """Playable EOD machines + distinct casinos per YYYY-MM (one identity per casino×asset)."""
    machines_by_ym: dict[str, int] = {}
    clients_by_ym: dict[str, int] = {}
    if not rows:
        for me in month_ends:
            ym = me.isoformat()[:7]
            machines_by_ym[ym] = 0
            clients_by_ym[ym] = 0
        return machines_by_ym, clients_by_ym

    by_ca: dict[tuple[str, str], list[dict[str, Any]]] = {}
    enriched_all: list[dict[str, Any]] = []
    for raw in rows:
        enriched = dict(raw)
        enriched["effective_from"] = _exec_effective_from(raw)
        enriched["non_playable"] = _exec_is_non_playable(raw)
        enriched_all.append(enriched)
        key = (str(raw.get("casino_id") or ""), str(raw.get("asset_id") or ""))
        by_ca.setdefault(key, []).append(enriched)

    for me in month_ends:
        ym = me.isoformat()[:7]
        month_start = me.replace(day=1)
        candidates: list[dict[str, Any]] = []
        for enriched in enriched_all:
            eff = enriched["effective_from"]
            rmvl = _as_date(enriched.get("rmvl_date"))
            if eff is None or eff > me:
                continue
            if rmvl is not None and rmvl <= me:
                continue
            key = (
                str(enriched.get("casino_id") or ""),
                str(enriched.get("asset_id") or ""),
            )
            if _exec_logic_suppress(
                enriched, by_ca.get(key, []), month_start=month_start, as_of=me
            ):
                continue
            candidates.append(enriched)

        best: dict[tuple[str, str], dict[str, Any]] = {}

        def _sort_key(r: dict[str, Any]) -> tuple:
            return (
                r["effective_from"],
                int(r.get("index_key") or 0),
                1 if r.get("is_active") else 0,
            )

        for r in sorted(candidates, key=_sort_key):
            key = (str(r.get("casino_id") or ""), str(r.get("asset_id") or ""))
            best[key] = r

        playable = [r for r in best.values() if not r.get("non_playable")]
        machines_by_ym[ym] = len(playable)
        clients_by_ym[ym] = len(
            {str(r.get("casino_id") or "") for r in playable if r.get("casino_id")}
        )
    return machines_by_ym, clients_by_ym


def _executive_ops_series(month_ends: list[date]) -> list[dict[str, Any]]:
    """Trailing ops metrics: EOD machines, convert+swap footprint, reporting coverage."""
    if not month_ends:
        return []

    window_start = date(month_ends[0].year, month_ends[0].month, 1)
    window_end = month_ends[-1]

    # --- Projects: calendar window (IMS). Most jobs are same-day / ≤3 days.
    # Open = still spanning M-end (start ≤ M < end). Ignore eMaint status and
    # undated Open rows — those were inflating the stock to ~60+.
    # Closed = end_date in M (status ignored; catches rare stale Open).
    closed_by_ym: dict[str, int] = {}
    try:
        for r in _app_query(
            """
            SELECT
                CONVERT(char(7), end_date, 126) AS ym,
                COUNT(*) AS n
            FROM projects.ims
            WHERE end_date IS NOT NULL
              AND CAST(end_date AS date) >= %s
              AND CAST(end_date AS date) <= %s
            GROUP BY CONVERT(char(7), end_date, 126)
            """,
            (window_start, window_end),
        ):
            ym = str(r.get("ym") or "").strip()
            if ym:
                closed_by_ym[ym] = int(r.get("n") or 0)
    except Exception:
        closed_by_ym = {}

    open_by_ym: dict[str, int] = {me.isoformat()[:7]: 0 for me in month_ends}
    try:
        proj_rows = _app_query(
            """
            SELECT start_date, end_date
            FROM projects.ims
            WHERE start_date IS NOT NULL
              AND end_date IS NOT NULL
              AND CAST(start_date AS date) <= %s
              AND CAST(end_date AS date) > %s
            """,
            (window_end, window_start),
        )
        for me in month_ends:
            ym = me.isoformat()[:7]
            n = 0
            for r in proj_rows:
                sd = _as_date(r.get("start_date"))
                ed = _as_date(r.get("end_date"))
                if sd is None or ed is None:
                    continue
                if sd <= me < ed:
                    n += 1
            open_by_ym[ym] = n
    except Exception:
        open_by_ym = {me.isoformat()[:7]: 0 for me in month_ends}

    # --- HubSpot deals: created / won / lost in month (not open-at-month-end stock) ---
    created_by_ym: dict[str, int] = {}
    won_by_ym: dict[str, int] = {}
    lost_by_ym: dict[str, int] = {}
    try:
        for r in _app_query(
            """
            SELECT
                CONVERT(char(7), create_date, 126) AS ym,
                COUNT(*) AS n
            FROM clients.hubspot_deal
            WHERE create_date IS NOT NULL
              AND create_date >= %s
              AND create_date <= %s
            GROUP BY CONVERT(char(7), create_date, 126)
            """,
            (window_start, window_end),
        ):
            ym = str(r.get("ym") or "").strip()
            if ym:
                created_by_ym[ym] = int(r.get("n") or 0)
    except Exception:
        created_by_ym = {}

    try:
        for r in _app_query(
            """
            SELECT
                CONVERT(char(7), close_date, 126) AS ym,
                SUM(CASE WHEN is_closed_won = 1 THEN 1 ELSE 0 END) AS won,
                SUM(
                    CASE
                        WHEN is_closed = 1 AND ISNULL(is_closed_won, 0) = 0 THEN 1
                        ELSE 0
                    END
                ) AS lost
            FROM clients.hubspot_deal
            WHERE close_date IS NOT NULL
              AND close_date >= %s
              AND close_date <= %s
            GROUP BY CONVERT(char(7), close_date, 126)
            """,
            (window_start, window_end),
        ):
            ym = str(r.get("ym") or "").strip()
            if not ym:
                continue
            won_by_ym[ym] = int(r.get("won") or 0)
            lost_by_ym[ym] = int(r.get("lost") or 0)
    except Exception:
        won_by_ym, lost_by_ym = {}, {}

    # --- EOD playable floor (machines + leased clients) ---
    smm_rows = _exec_fetch_smm_floor_rows()
    machines_by_ym, leased_by_ym = _exec_floor_counts_by_month(month_ends, smm_rows)

    # --- Footprint numerator: CONVERT + swaps (INSTALL/REMOVE same project) ---
    converts_by_ym: dict[str, int] = {}
    try:
        for r in _app_query(
            """
            SELECT
                CONVERT(char(7), lastconver, 126) AS ym,
                COUNT(DISTINCT asset_id) AS n
            FROM inventory.slot_master_migration
            WHERE UPPER(LTRIM(RTRIM(ISNULL(action, N'')))) = N'CONVERT'
              AND lastconver IS NOT NULL
              AND lastconver >= %s
              AND lastconver <= %s
            GROUP BY CONVERT(char(7), lastconver, 126)
            """,
            (window_start, window_end),
        ):
            ym = str(r.get("ym") or "").strip()
            if ym:
                converts_by_ym[ym] = int(r.get("n") or 0)
    except Exception:
        converts_by_ym = {}

    swaps_by_ym: dict[str, int] = {}
    try:
        for r in _app_query(
            """
            SELECT
                ym,
                SUM(CASE WHEN n_install < n_remove THEN n_install ELSE n_remove END) AS swaps
            FROM (
                SELECT
                    CONVERT(char(7), i.start_date, 126) AS ym,
                    pc.reference_key AS catalog_id,
                    SUM(CASE WHEN pd.action_type = N'INSTALL' THEN 1 ELSE 0 END) AS n_install,
                    SUM(CASE WHEN pd.action_type = N'REMOVE' THEN 1 ELSE 0 END) AS n_remove
                FROM projects.project_details AS pd
                INNER JOIN projects.project_catalog AS pc
                    ON pc.reference_key = pd.project_id
                INNER JOIN projects.ims AS i
                    ON i.reference_key = pc.ims_id
                WHERE pd.action_type IN (N'INSTALL', N'REMOVE')
                  AND i.start_date IS NOT NULL
                  AND i.start_date >= %s
                  AND i.start_date <= %s
                GROUP BY CONVERT(char(7), i.start_date, 126), pc.reference_key
                HAVING SUM(CASE WHEN pd.action_type = N'INSTALL' THEN 1 ELSE 0 END) > 0
                   AND SUM(CASE WHEN pd.action_type = N'REMOVE' THEN 1 ELSE 0 END) > 0
            ) AS x
            GROUP BY ym
            """,
            (window_start, window_end),
        ):
            ym = str(r.get("ym") or "").strip()
            if ym:
                swaps_by_ym[ym] = int(r.get("swaps") or 0)
    except Exception:
        swaps_by_ym = {}

    # --- Reporting coverage (casino grain from billing_coverage snapshot) ---
    expected_by_ym: dict[str, int] = {}
    reported_by_ym: dict[str, int] = {}
    try:
        cov_rows = mssql.query(
            """
            SELECT
                processing_month,
                casino_short,
                expected_entries,
                invoiced_entries
            FROM finance.billing_coverage
            WHERE processing_month >= %s
              AND processing_month <= %s
            """,
            params=(window_start, window_end),
            database=_revenue_catalog(),
            profile="dashboard",
            load_env=False,
        )
        exp_sets: dict[str, set[str]] = {}
        rep_sets: dict[str, set[str]] = {}
        for r in cov_rows:
            ym = _ym_label(r.get("processing_month"))
            casino = str(r.get("casino_short") or "").strip()
            if not ym or not casino:
                continue
            if int(r.get("expected_entries") or 0) > 0:
                exp_sets.setdefault(ym, set()).add(casino)
            if int(r.get("invoiced_entries") or 0) > 0:
                rep_sets.setdefault(ym, set()).add(casino)
        for ym in set(list(exp_sets.keys()) + list(rep_sets.keys())):
            expected_by_ym[ym] = len(exp_sets.get(ym, set()))
            reported_by_ym[ym] = len(rep_sets.get(ym, set()))
    except Exception:
        try:
            for r in _revenue_query(
                f"""
                SELECT
                    CONVERT(char(7), [date], 126) AS ym,
                    COUNT(DISTINCT RTRIM([Casino])) AS n
                FROM {_MV} AS mr
                WHERE [date] >= %s AND [date] <= %s
                GROUP BY CONVERT(char(7), [date], 126)
                """,
                (window_start, window_end),
            ):
                ym = str(r.get("ym") or "").strip()
                if ym:
                    reported_by_ym[ym] = int(r.get("n") or 0)
                    expected_by_ym[ym] = leased_by_ym.get(ym, 0)
        except Exception:
            pass

    series: list[dict[str, Any]] = []
    prev_machines: int | None = None
    for me in month_ends:
        ym = me.isoformat()[:7]
        machines = machines_by_ym.get(ym, 0)
        delta = (machines - prev_machines) if prev_machines is not None else 0
        prev_machines = machines
        converts = converts_by_ym.get(ym, 0)
        swaps = swaps_by_ym.get(ym, 0)
        changed = converts + swaps
        fp_pct = round((changed / machines) * 100.0, 2) if machines else 0.0
        expected = expected_by_ym.get(ym, 0)
        reported = reported_by_ym.get(ym, 0)
        rep_pct = round((reported / expected) * 100.0, 2) if expected else 0.0
        series.append(
            {
                "month": me.isoformat(),
                "projects": {
                    "open": open_by_ym.get(ym, 0),
                    "closed": closed_by_ym.get(ym, 0),
                },
                "deals": {
                    "created": created_by_ym.get(ym, 0),
                    "won": won_by_ym.get(ym, 0),
                    "closed": lost_by_ym.get(ym, 0),
                },
                "placements": {
                    "machines": machines,
                    "delta": delta,
                },
                "footprint": {
                    "changed": changed,
                    "converts": converts,
                    "swaps": swaps,
                    "active": machines,
                    "pct": fp_pct,
                },
                "leased_clients": leased_by_ym.get(ym, 0),
                "reporting": {
                    "reported": reported,
                    "expected": expected,
                    "pct": rep_pct,
                },
            }
        )
    return series


@router.get("/analyst/trends")
def analyst_trends():
    rows = _revenue_query(
        f"""
SELECT
    [date] AS d,
    SUM(ISNULL([Actual_win], 0)) AS actual_win,
    SUM(ISNULL([Theo_win], 0)) AS theo_win
FROM {_MV} AS mr
WHERE [date] IS NOT NULL
GROUP BY [date]
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


@router.get("/analyst/ping")
def analyst_ping():
    """No-auth probe: if this 404s, the image does not have the queue commit."""
    return {"ok": True, "queue": "/api/analyst/queue", "resolutions": "/api/analyst/resolutions"}


# Queue / summary / resolutions / resolve live on routers.analyst (dgs_analyst gate).
# Do not re-register them here — first match wins and stale assert_paul handlers break auth'd calls.


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
WHERE [date] = %s
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

# Playable-only expected rows — same tokens as MR processor floor compare.
# Primary: SMM asset_no + inventory.assets cabinet_type / machine_type.
# Fallback: cabinet name / serial text until asset attrs are stamped on all centers/signs.
# Theme EXISTS covers rare Sign rows with no asset row attrs (Harrah's OK signage).
_NON_PLAYABLE_SQL = """
  AND NOT (
    LOWER(LTRIM(RTRIM(COALESCE(sm.asset_no, N'')))) IN (N'center', N'sign', N'controller', N'server')
    OR LOWER(LTRIM(RTRIM(COALESCE(a.cabinet_type, N'')))) IN (N'center', N'sign', N'controller', N'server')
    OR LOWER(LTRIM(RTRIM(COALESCE(a.machine_type, N'')))) IN (N'center', N'sign', N'controller', N'server')
    OR CHARINDEX(N'center', LOWER(COALESCE(cab.cabinet_name, N''))) > 0
    OR CHARINDEX(N'sign', LOWER(COALESCE(cab.cabinet_name, N''))) > 0
    OR CHARINDEX(N'controller', LOWER(COALESCE(cab.cabinet_name, N''))) > 0
    OR CHARINDEX(N'server', LOWER(COALESCE(cab.cabinet_name, N''))) > 0
    OR CHARINDEX(N'center', LOWER(COALESCE(a.serial_number, N''))) > 0
    OR CHARINDEX(N'sign', LOWER(COALESCE(a.serial_number, N''))) > 0
    OR CHARINDEX(N'controller', LOWER(COALESCE(a.serial_number, N''))) > 0
    OR CHARINDEX(N'server', LOWER(COALESCE(a.serial_number, N''))) > 0
    OR EXISTS (
      SELECT 1 FROM vendors.themes AS th
      WHERE th.reference_key = sm.theme_id
        AND (
          LOWER(LTRIM(RTRIM(COALESCE(th.theme_name, N'')))) = N'sign'
          OR CHARINDEX(N'center', LOWER(COALESCE(th.theme_name, N''))) > 0
          OR CHARINDEX(N'controller', LOWER(COALESCE(th.theme_name, N''))) > 0
          OR CHARINDEX(N'server', LOWER(COALESCE(th.theme_name, N''))) > 0
        )
    )
  )
"""



@router.get("/finance/overview")
def finance_overview(
    from_month: str = Query(..., alias="from", description="Processing month range start (YYYY-MM)"),
    to_month: str = Query(..., alias="to", description="Processing month range end (YYYY-MM)"),
):
    """Billing coverage from ``finance.billing_coverage`` snapshot (hybrid refresh).

    Live SMM/MR recompute runs offline (MR apply + nightly). Same response shape as before.
    Set ``FINANCE_OVERVIEW_LIVE=1`` to force the legacy live engine.
    """
    if (os.environ.get("FINANCE_OVERVIEW_LIVE") or "").strip().lower() in ("1", "true", "yes"):
        return _finance_overview_live(from_month, to_month)

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
    window_end = _month_bounds(ext_months[-1])[0]

    rows = mssql.query(
        """
SELECT
    casino_short,
    processing_month,
    expected_entries,
    invoiced_entries,
    invoiced_keys,
    uninvoiced_keys,
    unexpected_keys,
    reporting_waived_keys,
    uninvoiced_actionable_keys,
    commission,
    last_report,
    refreshed_at
FROM finance.billing_coverage
WHERE processing_month BETWEEN %s AND %s
""",
        params=(window_start, window_end),
        database=_revenue_catalog(),
        profile="dashboard",
        load_env=False,
    )

    by_cm: dict[tuple[str, str], dict] = {}
    last_report: dict[str, str] = {}
    refreshed_at = None
    for r in rows:
        casino = str(r.get("casino_short") or "").strip()
        ym = _ym_label(r.get("processing_month"))
        if not casino or not ym:
            continue
        by_cm[(casino, ym)] = r
        d = _as_date(r.get("last_report"))
        if casino and d:
            prev = last_report.get(casino)
            if not prev or d.isoformat() > prev:
                last_report[casino] = d.isoformat()
        ra = r.get("refreshed_at")
        if ra is not None:
            refreshed_at = ra

    def month_totals(ym: str) -> dict:
        expected = 0
        entries = 0
        commission = 0.0
        inv_keys = 0
        uninvoiced = 0
        unexpected = 0
        waived = 0
        actionable = 0
        exp_casinos: set[str] = set()
        rep_casinos: set[str] = set()
        for (casino, m), row in by_cm.items():
            if m != ym:
                continue
            expected += int(row.get("expected_entries") or 0)
            entries += int(row.get("invoiced_entries") or 0)
            commission += float(row.get("commission") or 0)
            inv_keys += int(row.get("invoiced_keys") or 0)
            uninvoiced += int(row.get("uninvoiced_keys") or 0)
            unexpected += int(row.get("unexpected_keys") or 0)
            waived += int(row.get("reporting_waived_keys") or 0)
            actionable += int(row.get("uninvoiced_actionable_keys") or 0)
            if int(row.get("expected_entries") or 0) > 0:
                exp_casinos.add(casino)
            if int(row.get("invoiced_keys") or 0) > 0:
                rep_casinos.add(casino)
        return {
            "month": ym,
            "expected_entries": expected,
            "invoiced_entries": entries,
            "invoiced_keys": inv_keys,
            "uninvoiced_keys": uninvoiced,
            "reporting_waived_keys": waived,
            "uninvoiced_actionable_keys": actionable,
            "unexpected_keys": unexpected,
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

    all_casinos = sorted({c for (c, ym) in by_cm if ym in months})
    casinos_out = []
    for casino in all_casinos:
        row = by_cm.get((casino, t), {})
        expected = int(row.get("expected_entries") or 0)
        entries = int(row.get("invoiced_entries") or 0)
        waived_uninvoiced = int(row.get("reporting_waived_keys") or 0)
        missing_months = [
            ym
            for ym in months
            if int(by_cm.get((casino, ym), {}).get("expected_entries") or 0) > 0
            and int(by_cm.get((casino, ym), {}).get("invoiced_keys") or 0) == 0
        ]
        casinos_out.append(
            {
                "casino": casino,
                "expected_entries": expected,
                "invoiced_entries": entries,
                "invoiced_keys": int(row.get("invoiced_keys") or 0),
                "uninvoiced_keys": int(row.get("uninvoiced_keys") or 0),
                "reporting_waived_keys": waived_uninvoiced,
                "uninvoiced_actionable_keys": int(row.get("uninvoiced_actionable_keys") or 0),
                "unexpected_keys": int(row.get("unexpected_keys") or 0),
                "gap": entries - expected + waived_uninvoiced,
                "commission": float(row.get("commission") or 0),
                "last_report": last_report.get(casino),
                "missing_months": missing_months,
            }
        )
    casinos_out.sort(
        key=lambda r: (-r["uninvoiced_actionable_keys"], -len(r["missing_months"]), r["casino"])
    )

    return {
        "source": "snapshot",
        "from": f,
        "to": t,
        "months": months,
        "kpis": kpis,
        "monthly": monthly,
        "casinos": casinos_out,
        "refreshed_at": refreshed_at.isoformat()
        if hasattr(refreshed_at, "isoformat")
        else refreshed_at,
    }


def _finance_overview_live(
    from_month: str | None,
    to_month: str | None,
):
    """Billing coverage: expected migration rows vs invoiced MR entries by SMM key.

    - **Invoiced** = MR row count where ``slot_master_id`` is populated (one entry per MR line).
    - **Expected** = ``slot_master_migration`` rows active during the processing month
      (action-aware floor start / ``rmvl_date`` window), compared on
      ``slot_master_id`` ↔ ``reference_key``. Excludes non-playable participation gear
      (centers, signs, controllers, servers — same rule as MR processor floor compare).
      **Floor start (locked 2026-08-20):** ``date_instl`` / ``golive001`` apply only when the
      stint is an install-era row (``action`` is INSTALL or blank/legacy). CONVERT and
      UPGRADE start from ``lastconver`` so inherited cabinet install dates do not pull new
      theme/software rows into earlier months. Convert predecessors still close via another
      row's ``lastconver`` (no ``rmvl_date`` on theme change); earliest successor convert
      before month start excludes the row (convert month still counts).
      **MOVE supersede:** an *active* Type-2 ``action=MOVE`` twin at the same ``asset_id`` +
      ``casino_id`` replaces the prior identity using ``projects.ims.start_date`` (no fake
      ``rmvl_date`` / floor-start rewrite). Inactive historical MOVE rows do not supersede.
      Months before the move keep the prior; on/after the move month only the active MOVE
      row counts (bank move is not a dual-bill convert month).
      **UPGRADE supersede (locked 2026-08-25):** single-bill vs soft prior — in-window
      ``action=UPGRADE`` (``lastconver``→``rmvl``) excludes blank/INSTALL priors only (never
      CONVERT/MOVE). UPGRADE enters expected like CONVERT. Type-2: soft prior + UPGRADE TO
      (+ CONVERT if theme changes). No Finance-invented soft-prior ``rmvl``.
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
    mr.[date] AS d,
    LTRIM(RTRIM(mr.[slot_master_id])) AS smm_key
FROM {_MV} AS mr
LEFT JOIN inventory.slot_master_migration AS sm
    ON sm.reference_key = LTRIM(RTRIM(mr.[slot_master_id]))
LEFT JOIN clients.casinos AS c ON c.reference_key = sm.casino_id
WHERE mr.[date] IS NOT NULL
  AND mr.[date] BETWEEN %s AND %s
  AND NULLIF(LTRIM(RTRIM(mr.[slot_master_id])), N'') IS NOT NULL
"""
    mr_commission_sql = f"""
SELECT
    RTRIM([Casino]) AS casino,
    [date] AS d,
    COUNT(*) AS entries,
    SUM(ISNULL([Commission], 0)) AS commission
FROM {_MV} AS mr
WHERE [date] IS NOT NULL
  AND [date] BETWEEN %s AND %s
GROUP BY RTRIM([Casino]), [date]
"""
    last_report_sql = f"""
SELECT RTRIM([Casino]) AS casino, MAX([date]) AS last_report
FROM {_MV} AS mr
WHERE [date] IS NOT NULL
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
    m.me AS month_end,
    sm.reference_key AS smm_key,
    sm.date_instl,
    sm.golive001,
    cp.commission_rules
FROM (VALUES {values_rows}) AS m(ms, me)
JOIN inventory.slot_master_migration AS sm
    ON (
         CASE
           WHEN UPPER(LTRIM(RTRIM(COALESCE(sm.action, N'')))) IN (N'CONVERT', N'UPGRADE')
             THEN sm.lastconver
           ELSE COALESCE(sm.golive001, sm.date_instl)
         END
       ) IS NOT NULL
   AND CONVERT(date,
         CASE
           WHEN UPPER(LTRIM(RTRIM(COALESCE(sm.action, N'')))) IN (N'CONVERT', N'UPGRADE')
             THEN sm.lastconver
           ELSE COALESCE(sm.golive001, sm.date_instl)
         END
       ) <= CONVERT(date, m.me)
   AND (sm.rmvl_date IS NULL OR CONVERT(date, sm.rmvl_date) >= CONVERT(date, m.ms))
JOIN clients.casinos AS c ON c.reference_key = sm.casino_id
LEFT JOIN inventory.assets AS a ON a.reference_key = sm.asset_id
LEFT JOIN vendors.cabinets AS cab ON cab.reference_key = a.cabinet_id
LEFT JOIN finance.commission_profile AS cp ON cp.reference_key = sm.commission_profile_id
WHERE sm.casino_id <> %s
{_NON_PLAYABLE_SQL}
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
  /* MOVE supersede: active bank-move Type-2 twin replaces prior via IMS start_date.
     Prior excluded once move start <= month end; MOVE excluded until then.
     Inactive historical MOVE rows must not supersede later theme/install identities. */
  AND NOT (
    UPPER(LTRIM(RTRIM(COALESCE(sm.action, N'')))) <> N'MOVE'
    AND EXISTS (
      SELECT 1
      FROM inventory.slot_master_migration AS mv
      INNER JOIN projects.ims AS ims ON ims.reference_key = mv.project_id
      WHERE mv.asset_id = sm.asset_id
        AND mv.casino_id = sm.casino_id
        AND mv.reference_key <> sm.reference_key
        AND UPPER(LTRIM(RTRIM(COALESCE(mv.action, N'')))) = N'MOVE'
        AND mv.is_active = 1
        AND ims.start_date IS NOT NULL
        AND CONVERT(date, ims.start_date) <= CONVERT(date, m.me)
    )
  )
  AND NOT (
    UPPER(LTRIM(RTRIM(COALESCE(sm.action, N'')))) = N'MOVE'
    AND (
      sm.is_active <> 1
      OR sm.project_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM projects.ims AS ims
        WHERE ims.reference_key = sm.project_id
          AND ims.start_date IS NOT NULL
          AND CONVERT(date, ims.start_date) <= CONVERT(date, m.me)
      )
    )
  )
  /* UPGRADE supersede: in-window UPGRADE drops soft priors only (blank/INSTALL — not
     CONVERT/MOVE/UPGRADE). Single-bill vs prior software stint; convert month still
     dual-bills UPGRADE + CONVERT TO. */
  AND NOT (
    UPPER(LTRIM(RTRIM(COALESCE(sm.action, N'')))) NOT IN (N'UPGRADE', N'CONVERT', N'MOVE')
    AND EXISTS (
      SELECT 1
      FROM inventory.slot_master_migration AS upg
      WHERE upg.asset_id = sm.asset_id
        AND upg.casino_id = sm.casino_id
        AND upg.reference_key <> sm.reference_key
        AND UPPER(LTRIM(RTRIM(COALESCE(upg.action, N'')))) = N'UPGRADE'
        AND upg.lastconver IS NOT NULL
        AND CONVERT(date, upg.lastconver) <= CONVERT(date, m.me)
        AND (upg.rmvl_date IS NULL OR CONVERT(date, upg.rmvl_date) >= CONVERT(date, m.ms))
    )
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
    waived_sets: dict[tuple[str, str], set[str]] = {}
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
        month_end = _as_date(r.get("month_end"))
        if month_end:
            row = {
                "date_instl": _as_date(r.get("date_instl")),
                "golive001": _as_date(r.get("golive001")),
            }
            rules = parse_rules(r.get("commission_rules"))
            if reporting_waived(row, rules, month_end):
                waived_sets.setdefault(cm_key, set()).add(key)

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

        waived_keys: set[str] = set()
        for (casino, m), keys in waived_sets.items():
            if m == ym:
                waived_keys |= keys
        uninvoiced = exp_keys - inv_keys
        uninvoiced_actionable = uninvoiced - waived_keys

        return {
            "month": ym,
            "expected_entries": expected,
            "invoiced_entries": entries,
            "invoiced_keys": len(inv_keys),
            "uninvoiced_keys": len(uninvoiced),
            "reporting_waived_keys": len(waived_keys & uninvoiced),
            "uninvoiced_actionable_keys": len(uninvoiced_actionable),
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
        waived_set = waived_sets.get((casino, t), set())
        uninvoiced = exp_set - inv_set
        uninvoiced_actionable = uninvoiced - waived_set
        waived_uninvoiced = len(waived_set & uninvoiced)
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
                "uninvoiced_keys": len(uninvoiced),
                "reporting_waived_keys": waived_uninvoiced,
                "uninvoiced_actionable_keys": len(uninvoiced_actionable),
                "unexpected_keys": len(inv_set - exp_set),
                "gap": entries - expected + waived_uninvoiced,
                "commission": commission_by_key.get((casino, t), 0.0),
                "last_report": last_report.get(casino),
                "missing_months": missing_months,
            }
        )
    casinos_out.sort(
        key=lambda r: (-r["uninvoiced_actionable_keys"], -len(r["missing_months"]), r["casino"])
    )

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
    [date] AS d,
    SUM(ISNULL([Commission], 0)) AS commission,
    SUM(ISNULL([Actual_win], 0)) AS actual_win
FROM {_MV} AS mr
WHERE [date] IS NOT NULL
GROUP BY [date]
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
WHERE [date] = %s
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
