"""Truck (vehicle) stock from Locations + stock_balance; Add Stock for writers."""

from __future__ import annotations

import json
import os
import re
import threading
import time
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app import appsheet_client, mssql, view_as, wo_inventory_service as stock
from app import permission_catalog as cat
from app.auth_deps import require_area_read, require_area_write, require_demo_user

router = APIRouter(
    prefix="/api/truck-inventory",
    tags=["truck-inventory"],
    dependencies=[Depends(require_area_read(cat.TRUCK_INVENTORY_AREA))],
)

_VEHICLE_CODE = re.compile(r"^V\d+$", re.IGNORECASE)
# Same token scrub as work_orders part-catalog (AppSheet FIND tokens).
_PART_SEARCH_TOKEN = re.compile(r"[^a-zA-Z0-9._/-]+")
_VEHICLE_CACHE: dict[str, Any] = {"rows": None, "fetched_at": 0.0}
# Serve stale disk/memory immediately; refresh from AppSheet in the background.
_VEHICLE_SOFT_TTL_SEC = 5 * 60.0
_VEHICLE_HARD_TTL_SEC = 24 * 60 * 60.0
# Docker layout: /app/app/routers/… → /app/data (WORKDIR /app, COPY data ./data).
_VEHICLE_DISK = Path(__file__).resolve().parents[2] / "data" / "truck_vehicles_cache.json"
_vehicle_refresh_lock = threading.Lock()
_vehicle_refreshing = False


class AddStockIn(BaseModel):
    item: str = Field(min_length=1, max_length=40)
    qty: float = Field(gt=0, le=99999)
    from_bucket: str = Field(min_length=1, max_length=64)
    to_bucket: str = Field(min_length=1, max_length=20)


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


def _json_value(v):
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    return str(v).strip() if isinstance(v, str) else v


def _location_code(row: dict[str, Any]) -> str:
    for key in ("Location ID (Key)NameType", "Location ID (Key)", "Warehouse"):
        val = (row.get(key) or "").strip()
        if val:
            return val
    return (row.get("Name") or "").strip()


def _normalize_vehicle_rows(rows: list[dict[str, Any]] | None) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for row in rows or []:
        code = _location_code(row)
        if not _VEHICLE_CODE.match(code):
            continue
        out.append(
            {
                "code": code.upper() if code.upper().startswith("V") else code,
                "name": (row.get("Name") or "").strip(),
                "email": (row.get("Assigned User (Email)") or "").strip().lower(),
                "initials": (row.get("Tech Initial") or "").strip(),
            }
        )
    out.sort(key=lambda r: r["code"])
    return out


def _read_vehicle_disk() -> tuple[list[dict[str, str]] | None, float]:
    try:
        raw = json.loads(_VEHICLE_DISK.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return None, 0.0
    rows = raw.get("rows") if isinstance(raw, dict) else None
    fetched_at = float((raw or {}).get("fetched_at") or 0) if isinstance(raw, dict) else 0.0
    if not isinstance(rows, list) or not rows:
        return None, 0.0
    cleaned: list[dict[str, str]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        code = str(row.get("code") or "").strip().upper()
        if not _VEHICLE_CODE.match(code):
            continue
        cleaned.append(
            {
                "code": code,
                "name": str(row.get("name") or "").strip(),
                "email": str(row.get("email") or "").strip().lower(),
                "initials": str(row.get("initials") or "").strip(),
            }
        )
    cleaned.sort(key=lambda r: r["code"])
    return (cleaned or None), fetched_at


def _write_vehicle_disk(rows: list[dict[str, str]], fetched_at: float) -> None:
    try:
        _VEHICLE_DISK.parent.mkdir(parents=True, exist_ok=True)
        _VEHICLE_DISK.write_text(
            json.dumps({"fetched_at": fetched_at, "rows": rows}, indent=2),
            encoding="utf-8",
        )
    except OSError:
        pass


def _fetch_vehicles_from_appsheet() -> list[dict[str, str]]:
    try:
        rows = appsheet_client.find_rows(
            appsheet_client.LOCATIONS_TABLE,
            selector='FILTER(Locations, [Type] = "Vehicle")',
        )
    except appsheet_client.AppSheetError as exc:
        raise HTTPException(status_code=502, detail=f"Locations lookup failed: {exc}") from exc
    return _normalize_vehicle_rows(rows)


def _store_vehicles(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    fetched_at = time.time()
    _VEHICLE_CACHE["rows"] = rows
    _VEHICLE_CACHE["fetched_at"] = fetched_at
    _write_vehicle_disk(rows, fetched_at)
    return list(rows)


def _refresh_vehicles_background() -> None:
    global _vehicle_refreshing
    try:
        rows = _fetch_vehicles_from_appsheet()
        _store_vehicles(rows)
    except Exception:
        pass
    finally:
        with _vehicle_refresh_lock:
            _vehicle_refreshing = False


def _schedule_vehicle_refresh() -> None:
    global _vehicle_refreshing
    with _vehicle_refresh_lock:
        if _vehicle_refreshing:
            return
        _vehicle_refreshing = True
    threading.Thread(target=_refresh_vehicles_background, daemon=True).start()


def _vehicle_rows(*, force: bool = False) -> list[dict[str, str]]:
    """Vehicle roster for picker / ownership checks.

    AppSheet Locations pull is ~2–3s, so we serve memory/disk cache immediately and
    refresh in the background when soft-stale.
    """
    now = time.time()
    cached = _VEHICLE_CACHE.get("rows")
    fetched_at = float(_VEHICLE_CACHE.get("fetched_at") or 0)
    if cached is None:
        disk_rows, disk_at = _read_vehicle_disk()
        if disk_rows:
            cached = disk_rows
            fetched_at = disk_at
            _VEHICLE_CACHE["rows"] = disk_rows
            _VEHICLE_CACHE["fetched_at"] = disk_at

    age = now - fetched_at if fetched_at else None
    if force or cached is None:
        rows = _fetch_vehicles_from_appsheet()
        return _store_vehicles(rows)

    if age is not None and age > _VEHICLE_SOFT_TTL_SEC:
        _schedule_vehicle_refresh()
    if age is not None and age > _VEHICLE_HARD_TTL_SEC:
        # Extremely stale — still return it, but force a refresh attempt.
        _schedule_vehicle_refresh()
    return list(cached)


# Warm roster at import so the first browser hit after restart rarely waits on AppSheet.
_schedule_vehicle_refresh()


def _can_browse_all(user: dict[str, Any] | None) -> bool:
    if user is None:
        return True
    return cat.has_area_read(user.get("permissions") or {}, cat.PARTS_INVENTORY_AREA)


def _can_write_truck(user: dict[str, Any] | None) -> bool:
    if user is None:
        return False
    return cat.has_area_write(user.get("permissions") or {}, cat.TRUCK_INVENTORY_AREA)


def _resolve_my_vehicle(
    user: dict[str, Any] | None,
    vehicles: list[dict[str, str]],
) -> dict[str, str] | None:
    if user is None:
        return vehicles[0] if vehicles else None
    email = view_as.effective_email(user)
    if not email:
        return None
    for row in vehicles:
        if row.get("email") == email:
            return row
    return None


def _stock_for_bucket(bucket: str, q: str = "") -> list[dict[str, Any]]:
    search = (q or "").strip()
    like = f"%{search}%" if search else None
    filters = "WHERE sb.bucket = %s AND sb.qty > 0"
    params: list[Any] = [bucket]
    if like:
        filters += (
            " AND ("
            "sb.item LIKE %s OR i.descrip LIKE %s OR i.mfrpartno LIKE %s OR i.mfr LIKE %s"
            ")"
        )
        params.extend([like, like, like, like])
    rows = _field_query(
        f"""
        SELECT
            sb.item,
            sb.bucket,
            sb.condition,
            sb.qty,
            i.descrip,
            i.mfr,
            i.mfrpartno,
            i.item_family
        FROM inventory.stock_balance AS sb
        LEFT JOIN inventory.inventory AS i ON i.item = sb.item
        {filters}
        ORDER BY sb.qty DESC, sb.item ASC
        """,
        params,
    )
    return [
        {
            "item": _json_value(r.get("item")),
            "bucket": _json_value(r.get("bucket")),
            "condition": _json_value(r.get("condition")),
            "qty": _json_value(r.get("qty")),
            "descrip": _json_value(r.get("descrip")),
            "mfr": _json_value(r.get("mfr")),
            "mfrpartno": _json_value(r.get("mfrpartno")),
            "item_family": _json_value(r.get("item_family")),
        }
        for r in rows
    ]


def _assert_to_bucket_allowed(
    user: dict[str, Any] | None,
    to_bucket: str,
    vehicles: list[dict[str, str]],
) -> None:
    code = (to_bucket or "").strip().upper()
    if not _VEHICLE_CODE.match(code):
        raise HTTPException(status_code=400, detail="Invalid vehicle bucket")
    if _can_browse_all(user):
        if not any(v["code"].upper() == code for v in vehicles):
            raise HTTPException(status_code=404, detail=f"Unknown vehicle {code}")
        return
    mine = _resolve_my_vehicle(user, vehicles)
    if not mine or mine["code"].upper() != code:
        raise HTTPException(status_code=403, detail="Not available for this truck")


@router.get("")
def truck_inventory(
    bucket: str = Query("", max_length=20),
    q: str = Query("", max_length=120),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    """Vehicle stock for the signed-in tech, or a picked truck for office browse."""
    vehicles = _vehicle_rows()
    mine = _resolve_my_vehicle(user, vehicles)
    browse_all = _can_browse_all(user)
    requested = (bucket or "").strip().upper()

    if requested:
        if not _VEHICLE_CODE.match(requested):
            raise HTTPException(status_code=400, detail="Invalid vehicle bucket")
        if not browse_all and (not mine or mine["code"].upper() != requested):
            raise HTTPException(status_code=403, detail="Not available for this truck")
        active_code = requested
    elif mine:
        active_code = mine["code"].upper()
    elif browse_all and vehicles:
        active_code = vehicles[0]["code"].upper()
    else:
        return {
            "ok": True,
            "browse_all": browse_all,
            "can_write": _can_write_truck(user),
            "vehicle": None,
            "vehicles": vehicles if browse_all else [],
            "parts": [],
            "count": 0,
            "message": (
                "No vehicle Locations row matches your email. "
                "Ask inventory to set Assigned User (Email) on your truck."
            ),
        }

    active = next((v for v in vehicles if v["code"].upper() == active_code), None)
    if not active:
        raise HTTPException(status_code=404, detail=f"Unknown vehicle {active_code}")

    try:
        parts = _stock_for_bucket(active_code, q)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    return {
        "ok": True,
        "browse_all": browse_all,
        "can_write": _can_write_truck(user),
        "vehicle": active,
        "vehicles": vehicles if browse_all else ([mine] if mine else []),
        "parts": parts,
        "count": len(parts),
        "q": (q or "").strip() or None,
    }


def _part_search_tokens(needle: str) -> list[str]:
    """AND'd search tokens — same rules as work_orders ``_parts_search_selector``."""
    cleaned = (needle or "").strip()
    raw_tokens = [t for t in re.split(r"\s+", cleaned) if t]
    tokens: list[str] = []
    for raw in raw_tokens:
        tok = _PART_SEARCH_TOKEN.sub("", raw).lower()
        if len(tok) >= 2:
            tokens.append(tok)
        elif len(tok) == 1 and tokens:
            tokens.append(tok)
    if not tokens:
        fallback = _PART_SEARCH_TOKEN.sub("", cleaned).lower()
        if len(fallback) >= 2:
            tokens = [fallback]
    return tokens[:6]


@router.get("/parts-search")
def parts_search(
    q: str = Query("", max_length=80),
    limit: int = Query(25, ge=1, le=50),
    user: Annotated[dict[str, Any] | None, Depends(require_area_write(cat.TRUCK_INVENTORY_AREA))] = None,
):
    """Fast SQL part picker for Add Stock (tokenized like WO / AppSheet)."""
    del user
    needle = (q or "").strip()
    if len(needle) < 2:
        return {"ok": True, "q": needle or None, "parts": [], "count": 0}
    tokens = _part_search_tokens(needle)
    if not tokens:
        return {"ok": True, "q": needle, "parts": [], "count": 0}
    lim = max(1, min(int(limit), 50))
    token_clauses: list[str] = []
    params: list[Any] = [lim]
    for tok in tokens:
        like = f"%{tok}%"
        token_clauses.append(
            "("
            "i.item LIKE %s OR i.descrip LIKE %s OR i.mfr LIKE %s OR i.mfrpartno LIKE %s"
            ")"
        )
        params.extend([like, like, like, like])
    # Prefer exact / prefix hits on the full typed string when present.
    params.extend([needle, f"{needle}%"])
    try:
        rows = _field_query(
            f"""
            SELECT TOP (%s)
                i.item,
                i.descrip,
                i.mfr,
                i.mfrpartno
            FROM inventory.inventory AS i
            LEFT JOIN inventory.software AS sw ON sw.item = i.item
            WHERE sw.item IS NULL
              AND i.item IS NOT NULL
              AND LTRIM(RTRIM(i.item)) <> N''
              AND {' AND '.join(token_clauses)}
            ORDER BY
                CASE WHEN i.item = %s THEN 0
                     WHEN i.item LIKE %s THEN 1
                     ELSE 2 END,
                i.item
            """,
            tuple(params),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    parts = [
        {
            "item": _json_value(r.get("item")),
            "name": _json_value(r.get("descrip")),
            "mfr": _json_value(r.get("mfr")),
            "mfr_part": _json_value(r.get("mfrpartno")),
        }
        for r in rows
        if _json_value(r.get("item"))
    ]
    return {"ok": True, "q": needle, "parts": parts, "count": len(parts)}


@router.get("/source-buckets")
def source_buckets(
    item: str = Query("", max_length=80),
    user: Annotated[dict[str, Any] | None, Depends(require_area_write(cat.TRUCK_INVENTORY_AREA))] = None,
):
    """Good-stock From buckets for Add Stock (per-item when ``item`` is set)."""
    del user
    part = (item or "").strip()
    try:
        buckets = stock.list_good_source_buckets(part or None)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    return {"ok": True, "item": part or None, "buckets": buckets}


@router.post("/add-stock")
def add_stock(
    body: AddStockIn,
    user: Annotated[dict[str, Any] | None, Depends(require_area_write(cat.TRUCK_INVENTORY_AREA))] = None,
):
    """Move AVAILABLE qty from a warehouse-style bucket onto a vehicle."""
    vehicles = _vehicle_rows()
    to_bucket = (body.to_bucket or "").strip().upper()
    _assert_to_bucket_allowed(user, to_bucket, vehicles)
    who = view_as.effective_email(user) or (user or {}).get("email") or "dgs"
    try:
        result = stock.add_stock_to_truck(
            item=body.item,
            qty=body.qty,
            from_bucket=body.from_bucket,
            to_bucket=to_bucket,
            created_by=str(who)[:128],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    return {"ok": True, **result}
