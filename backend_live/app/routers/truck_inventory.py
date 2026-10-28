"""Read-only truck (vehicle) stock from Locations + stock_balance."""

from __future__ import annotations

import os
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app import appsheet_client, mssql
from app import permission_catalog as cat
from app.auth_deps import require_area_read, require_demo_user

router = APIRouter(
    prefix="/api/truck-inventory",
    tags=["truck-inventory"],
    dependencies=[Depends(require_area_read(cat.TRUCK_INVENTORY_AREA))],
)

_VEHICLE_CODE = re.compile(r"^V\d+$", re.IGNORECASE)


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


def _vehicle_rows() -> list[dict[str, str]]:
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
    return out


def _can_browse_all(user: dict[str, Any] | None) -> bool:
    if user is None:
        return True
    return cat.has_area_read(user.get("permissions") or {}, cat.PARTS_INVENTORY_AREA)


def _resolve_my_vehicle(
    user: dict[str, Any] | None,
    vehicles: list[dict[str, str]],
) -> dict[str, str] | None:
    if user is None:
        return vehicles[0] if vehicles else None
    email = (user.get("email") or "").strip().lower()
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
        "vehicle": active,
        "vehicles": vehicles if browse_all else ([mine] if mine else []),
        "parts": parts,
        "count": len(parts),
        "q": (q or "").strip() or None,
    }
