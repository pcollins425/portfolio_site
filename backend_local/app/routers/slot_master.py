"""Slot Master browse + edit API — inventory.slot_master_migration."""

from __future__ import annotations

import math
import os
from datetime import date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app import auth_service, mssql
from app import slot_master_permissions as sm_perms
from app.auth_deps import require_demo_user

router = APIRouter(prefix="/api/slot-master", tags=["slot-master"])

_EDITABLE_COLS = (
    "comment",
    "zone",
    "bank",
    "location",
    "asset_no",
    "denom",
    "logic_box",
    "os_version",
    "theo_hold",
    "Hold",
    "prog_media",
    "paytable",
    "date_instl",
    "golive001",
    "lastconver",
    "rmvl_date",
    "prog_type",
    "prog_level",
    "reset_1",
    "reset_2",
    "reset_3",
    "reset_4",
    "reset_5",
    "reset_6",
    "reset_7",
    "reset_8",
    "prog_1",
    "prog_2",
    "prog_3",
    "prog_4",
    "prog_5",
    "prog_6",
    "prog_7",
    "prog_8",
    "top_award",
    "reels",
    "no_lines",
    "bet_line",
    "maxcoinbet",
    "betconfig",
    "butt_panel",
    "top_boxtyp",
    "back_os",
    "boot_bios",
    "printermod",
    "print_soft",
    "bill_valid",
    "billvalsft",
    "mon_type",
    "toppertype",
)

_DATE_COLS = frozenset({"date_instl", "golive001", "lastconver", "rmvl_date"})

_MACHINE_JOIN = """
    FROM inventory.slot_master_migration AS sm
    INNER JOIN inventory.assets AS a ON a.reference_key = sm.asset_id
    LEFT JOIN vendors.vendors AS v ON v.reference_key = a.vendor_id
    LEFT JOIN vendors.cabinets AS cab ON cab.reference_key = a.cabinet_id
    LEFT JOIN vendors.themes AS th ON th.reference_key = sm.theme_id
    INNER JOIN clients.casinos AS c ON c.reference_key = sm.casino_id
"""


class RowPatchBody(BaseModel):
    updates: dict[str, Any] = Field(default_factory=dict)


def _catalog() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _field_query(sql: str, params=None):
    return mssql.query(
        sql,
        params=params,
        database=_catalog(),
        profile="field",
        load_env=False,
    )


def _field_execute(sql: str, params=None) -> int:
    return mssql.execute(
        sql,
        params=params,
        database=_catalog(),
        profile="field",
        load_env=False,
    )


def _json_value(v):
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    return str(v).strip() if isinstance(v, str) else v


def _parse_date_value(val: Any) -> datetime | None:
    if val is None or val == "":
        return None
    if isinstance(val, datetime):
        return val
    if isinstance(val, date):
        return datetime.combine(val, datetime.min.time())
    s = str(val).strip()
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(s[:19], fmt)
        except ValueError:
            continue
    raise ValueError(f"invalid date: {val!r}")


def _machine_row(r: dict) -> dict:
    zbl = " · ".join(
        x for x in (_json_value(r.get("zone")), _json_value(r.get("bank")), _json_value(r.get("location"))) if x
    )
    return {
        "reference_key": _json_value(r.get("reference_key")),
        "index_key": int(r["index_key"]) if r.get("index_key") is not None else None,
        "is_active": bool(r.get("is_active")),
        "asset_id": _json_value(r.get("asset_id")),
        "casino_id": _json_value(r.get("casino_id")),
        "theme_id": _json_value(r.get("theme_id")),
        "serial": _json_value(r.get("serial_number")),
        "vendor_name": _json_value(r.get("vendor_name")),
        "cabinet_name": _json_value(r.get("cabinet_name")),
        "theme_name": _json_value(r.get("theme_name")),
        "casino_name": _json_value(r.get("casino_name")),
        "zbl": zbl or None,
        "zone": _json_value(r.get("zone")),
        "bank": _json_value(r.get("bank")),
        "location": _json_value(r.get("location")),
        "asset_no": _json_value(r.get("asset_no")),
        "Hold": _json_value(r.get("Hold")),
        "denom": _json_value(r.get("denom")),
        "date_instl": _json_value(r.get("date_instl")),
        "lastconver": _json_value(r.get("lastconver")),
    }


def _detail_row(r: dict) -> dict:
    out = _machine_row(r)
    for col in _EDITABLE_COLS:
        if col not in out:
            out[col] = _json_value(r.get(col))
    out["insert_date"] = _json_value(r.get("insert_date"))
    out["update_date"] = _json_value(r.get("update_date"))
    out["update_by"] = _json_value(r.get("update_by"))
    out["change_log"] = _json_value(r.get("change_log"))
    out["project_id"] = _json_value(r.get("project_id"))
    out["action"] = _json_value(r.get("action"))
    return out


def _assert_write(user: dict[str, Any] | None) -> None:
    if not auth_service.auth_required():
        return
    if not user:
        raise HTTPException(status_code=401, detail="Sign in required")
    if not sm_perms.can_write(user.get("permissions") or {}):
        raise HTTPException(status_code=403, detail="No Slot Master write access")


def _fetch_machine(reference_key: str) -> dict | None:
    rows = _field_query(
        f"""
        SELECT
            sm.*,
            a.serial_number,
            v.vendor_name,
            cab.cabinet_name,
            th.theme_name,
            c.casino_name
        {_MACHINE_JOIN}
        WHERE sm.reference_key = %s
        """,
        (reference_key,),
    )
    return rows[0] if rows else None


@router.get("/health")
def slot_master_health():
    catalog = _catalog()
    ok = False
    n = None
    try:
        row = _field_query("SELECT COUNT(*) AS n FROM inventory.slot_master_migration")[0]
        n = int(row["n"])
        ok = True
    except Exception:
        pass
    ext = os.environ.get("MSSQL_EXTERNAL") or os.environ.get("MSSQL_HOST")
    return {"ok": ok, "database": catalog, "row_count": n, "host": ext}


@router.get("/permissions")
def slot_master_permissions(
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    perms = (user or {}).get("permissions") or {}
    auth_on = auth_service.auth_required()
    return {
        "auth_required": auth_on,
        "can_read": (not auth_on) or sm_perms.can_read(perms),
        "can_write": (not auth_on) or sm_perms.can_write(perms),
        "level": sm_perms.level(perms),
        "editable_columns": list(_EDITABLE_COLS),
    }


@router.get("/states")
def list_states():
    try:
        rows = _field_query(
            """
            SELECT
                st.reference_key AS state_id,
                st.state AS state_name,
                COUNT(DISTINCT sm.reference_key) AS active_count
            FROM inventory.slot_master_migration AS sm
            INNER JOIN clients.casinos AS c ON c.reference_key = sm.casino_id
            LEFT JOIN clients.tribes AS t ON t.reference_key = c.tribe_id
            LEFT JOIN clients.states AS st ON st.reference_key = COALESCE(c.state_id, t.state_id)
            WHERE sm.is_active = 1
              AND st.reference_key IS NOT NULL
            GROUP BY st.reference_key, st.state
            ORDER BY st.state
            """
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    return {
        "items": [
            {
                "state_id": r["state_id"],
                "state_name": r["state_name"],
                "active_count": int(r["active_count"]),
            }
            for r in rows
        ]
    }


@router.get("/tribes")
def list_tribes(state_id: str = Query(..., min_length=1, max_length=25)):
    sid = state_id.strip()
    try:
        rows = _field_query(
            """
            SELECT
                t.reference_key AS tribe_id,
                t.tribe_name,
                COUNT(DISTINCT sm.reference_key) AS active_count
            FROM inventory.slot_master_migration AS sm
            INNER JOIN clients.casinos AS c ON c.reference_key = sm.casino_id
            INNER JOIN clients.tribes AS t ON t.reference_key = c.tribe_id
            LEFT JOIN clients.states AS st ON st.reference_key = COALESCE(c.state_id, t.state_id)
            WHERE sm.is_active = 1
              AND st.reference_key = %s
            GROUP BY t.reference_key, t.tribe_name
            ORDER BY t.tribe_name
            """,
            (sid,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    return {
        "state_id": sid,
        "items": [
            {
                "tribe_id": r["tribe_id"],
                "tribe_name": r["tribe_name"],
                "active_count": int(r["active_count"]),
            }
            for r in rows
        ],
    }


@router.get("/casinos")
def list_casinos(tribe_id: str = Query(..., min_length=1, max_length=25)):
    tid = tribe_id.strip()
    try:
        rows = _field_query(
            """
            SELECT
                c.reference_key AS casino_id,
                c.casino_name,
                COUNT(DISTINCT sm.reference_key) AS active_count
            FROM inventory.slot_master_migration AS sm
            INNER JOIN clients.casinos AS c ON c.reference_key = sm.casino_id
            WHERE sm.is_active = 1
              AND c.tribe_id = %s
            GROUP BY c.reference_key, c.casino_name
            ORDER BY c.casino_name
            """,
            (tid,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    return {
        "tribe_id": tid,
        "items": [
            {
                "casino_id": r["casino_id"],
                "casino_name": r["casino_name"],
                "active_count": int(r["active_count"]),
            }
            for r in rows
        ],
    }


@router.get("/machines")
def list_machines(
    casino_id: str = Query(..., min_length=1, max_length=25),
    q: str = Query("", max_length=120),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
):
    cid = casino_id.strip()
    search = q.strip()
    like = f"%{search}%" if search else None

    search_sql = ""
    search_params: tuple = ()
    if like:
        search_sql = """
            AND (
                a.serial_number LIKE %s
                OR v.vendor_name LIKE %s
                OR cab.cabinet_name LIKE %s
                OR th.theme_name LIKE %s
                OR sm.zone LIKE %s
                OR sm.bank LIKE %s
                OR sm.location LIKE %s
                OR sm.asset_no LIKE %s
            )
        """
        search_params = (like,) * 8

    try:
        stats = _field_query(
            f"""
            SELECT
                SUM(CASE WHEN sm.is_active = 1 THEN 1 ELSE 0 END) AS active_count,
                COUNT(*) AS history_count,
                COUNT(DISTINCT CONCAT(ISNULL(a.vendor_id, N''), N'|', ISNULL(a.cabinet_id, N''))) AS cabinet_types
            FROM inventory.slot_master_migration AS sm
            INNER JOIN inventory.assets AS a ON a.reference_key = sm.asset_id
            WHERE sm.casino_id = %s
            """,
            (cid,),
        )[0]

        count_row = _field_query(
            f"""
            SELECT COUNT(*) AS n
            {_MACHINE_JOIN}
            WHERE sm.casino_id = %s
              AND sm.is_active = 1
            {search_sql}
            """,
            (cid,) + search_params,
        )[0]
        total_items = int(count_row["n"])

        offset = (page - 1) * page_size
        item_rows = _field_query(
            f"""
            SELECT
                sm.reference_key,
                sm.index_key,
                sm.is_active,
                sm.asset_id,
                sm.casino_id,
                sm.theme_id,
                sm.zone,
                sm.bank,
                sm.location,
                sm.asset_no,
                sm.Hold,
                sm.denom,
                sm.date_instl,
                sm.lastconver,
                a.serial_number,
                v.vendor_name,
                cab.cabinet_name,
                th.theme_name,
                c.casino_name
            {_MACHINE_JOIN}
            WHERE sm.casino_id = %s
              AND sm.is_active = 1
            {search_sql}
            ORDER BY a.serial_number
            OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY
            """,
            (cid,) + search_params,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    total_pages = max(1, math.ceil(total_items / page_size)) if total_items else 1

    return {
        "casino_id": cid,
        "search": search or None,
        "active_count": int(stats.get("active_count") or 0),
        "history_count": int(stats.get("history_count") or 0),
        "cabinet_types": int(stats.get("cabinet_types") or 0),
        "items": [_machine_row(r) for r in item_rows],
        "page": page,
        "page_size": page_size,
        "total": total_items,
        "total_pages": total_pages,
    }


@router.get("/assets/{asset_id}/history")
def asset_history(asset_id: str):
    aid = asset_id.strip()
    try:
        rows = _field_query(
            f"""
            SELECT
                sm.reference_key,
                sm.index_key,
                sm.is_active,
                sm.asset_id,
                sm.casino_id,
                sm.theme_id,
                sm.zone,
                sm.bank,
                sm.location,
                sm.lastconver,
                sm.date_instl,
                sm.rmvl_date,
                th.theme_name,
                c.casino_name
            FROM inventory.slot_master_migration AS sm
            LEFT JOIN vendors.themes AS th ON th.reference_key = sm.theme_id
            LEFT JOIN clients.casinos AS c ON c.reference_key = sm.casino_id
            WHERE sm.asset_id = %s
            ORDER BY sm.index_key DESC
            """,
            (aid,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    return {
        "asset_id": aid,
        "items": [
            {
                "reference_key": _json_value(r.get("reference_key")),
                "index_key": int(r["index_key"]) if r.get("index_key") is not None else None,
                "is_active": bool(r.get("is_active")),
                "casino_id": _json_value(r.get("casino_id")),
                "casino_name": _json_value(r.get("casino_name")),
                "theme_id": _json_value(r.get("theme_id")),
                "theme_name": _json_value(r.get("theme_name")),
                "zbl": " · ".join(
                    x
                    for x in (_json_value(r.get("zone")), _json_value(r.get("bank")), _json_value(r.get("location")))
                    if x
                )
                or None,
                "date_instl": _json_value(r.get("date_instl")),
                "lastconver": _json_value(r.get("lastconver")),
                "rmvl_date": _json_value(r.get("rmvl_date")),
            }
            for r in rows
        ],
    }


@router.get("/machines/{reference_key}")
def machine_detail(reference_key: str):
    key = reference_key.strip()
    try:
        row = _fetch_machine(key)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    if not row:
        raise HTTPException(status_code=404, detail=f"machine not found: {key!r}")
    return _detail_row(row)


@router.patch("/machines/{reference_key}")
def patch_machine(
    reference_key: str,
    body: RowPatchBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user)
    key = reference_key.strip()
    updates = body.updates or {}
    if not updates:
        raise HTTPException(status_code=400, detail="updates required")

    unknown = [k for k in updates if k not in _EDITABLE_COLS]
    if unknown:
        raise HTTPException(status_code=400, detail=f"unknown or read-only fields: {', '.join(unknown)}")

    row = _fetch_machine(key)
    if not row:
        raise HTTPException(status_code=404, detail=f"machine not found: {key!r}")

    set_parts: list[str] = []
    params: list[Any] = []
    log_bits: list[str] = []

    for col, new_val in updates.items():
        if col in _DATE_COLS:
            parsed = _parse_date_value(new_val)
            old_val = row.get(col)
            set_parts.append(f"[{col}] = %s")
            params.append(parsed)
            log_bits.append(f"{col}: {_json_value(old_val)} -> {_json_value(parsed)}")
        else:
            new_str = _json_value(new_val) if new_val is not None and new_val != "" else None
            old_str = _json_value(row.get(col))
            if old_str == new_str:
                continue
            set_parts.append(f"[{col}] = %s")
            params.append(new_str)
            log_bits.append(f"{col}: {old_str or '(null)'} -> {new_str or '(null)'}")

    if not set_parts:
        return _detail_row(row)

    actor = (user or {}).get("email") or (user or {}).get("name") or "api"
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    log_line = f"{stamp} {actor}: " + "; ".join(log_bits)
    prior = _json_value(row.get("change_log")) or ""
    merged_log = f"{prior}; {log_line}" if prior else log_line

    set_parts.append("[update_by] = %s")
    params.append(actor)
    set_parts.append("[change_log] = %s")
    params.append(merged_log)
    params.append(key)

    sql = f"""
        UPDATE inventory.slot_master_migration
        SET {", ".join(set_parts)}
        WHERE reference_key = %s
    """
    try:
        n = _field_execute(sql, tuple(params))
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    if n != 1:
        raise HTTPException(status_code=500, detail="update did not affect exactly one row")

    updated = _fetch_machine(key)
    return _detail_row(updated) if updated else {"reference_key": key, "updated": True}
