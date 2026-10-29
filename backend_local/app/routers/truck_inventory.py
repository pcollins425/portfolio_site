"""Truck (vehicle) stock from Locations + stock_balance; Add Stock for writers."""

from __future__ import annotations

import os
import re
import time
from datetime import date, datetime
from decimal import Decimal
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
_VEHICLE_CACHE: dict[str, Any] = {"rows": None, "expires": 0.0}
_VEHICLE_CACHE_TTL_SEC = 120.0


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


def _vehicle_rows(*, force: bool = False) -> list[dict[str, str]]:
    now = time.time()
    cached = _VEHICLE_CACHE.get("rows")
    if (
        not force
        and cached is not None
        and float(_VEHICLE_CACHE.get("expires") or 0) > now
    ):
        return list(cached)
    try:
        rows = appsheet_client.find_rows(
            appsheet_client.LOCATIONS_TABLE,
            selector='FILTER(Locations, [Type] = "Vehicle")',
        )
    except appsheet_client.AppSheetError as exc:
        raise HTTPException(status_code=502, detail=f"Locations lookup failed: {exc}") from exc
    out: list[dict[str, str]] = []
    for row in rows:
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
    _VEHICLE_CACHE["rows"] = out
    _VEHICLE_CACHE["expires"] = now + _VEHICLE_CACHE_TTL_SEC
    return out


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


@router.get("/parts-search")
def parts_search(
    q: str = Query("", max_length=80),
    limit: int = Query(25, ge=1, le=50),
    user: Annotated[dict[str, Any] | None, Depends(require_area_write(cat.TRUCK_INVENTORY_AREA))] = None,
):
    """Fast SQL part picker for Add Stock (avoids AppSheet Parts search latency)."""
    del user
    needle = (q or "").strip()
    if len(needle) < 2:
        return {"ok": True, "q": needle or None, "parts": [], "count": 0}
    like = f"%{needle}%"
    lim = max(1, min(int(limit), 50))
    try:
        rows = _field_query(
            """
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
              AND (
                    i.item LIKE %s
                 OR i.descrip LIKE %s
                 OR i.mfr LIKE %s
                 OR i.mfrpartno LIKE %s
              )
            ORDER BY
                CASE WHEN i.item = %s THEN 0
                     WHEN i.item LIKE %s THEN 1
                     ELSE 2 END,
                i.item
            """,
            (lim, like, like, like, like, needle, f"{needle}%"),
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
