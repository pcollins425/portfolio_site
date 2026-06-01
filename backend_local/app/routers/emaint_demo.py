"""eMaint replacement demo — browse grid + record form; inventory attributes PATCH."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app import emaint_demo_permissions as perms
from app import emaint_demo_service
from app import wo_inventory_service
from app.auth_deps import require_demo_user

router = APIRouter(prefix="/api/emaint-demo", tags=["emaint-demo"])


class RowPatchBody(BaseModel):
    updates: dict[str, Any] = Field(..., min_length=1)


def _assert_read(user: dict[str, Any] | None, table_id: str) -> None:
    if user is None:
        return
    if not perms.can_read_table(user.get("permissions") or {}, table_id):
        raise HTTPException(status_code=403, detail=f"No read access to {table_id}")


def _assert_write(user: dict[str, Any] | None, table_id: str) -> None:
    if user is None:
        return
    if not perms.can_write_table(user.get("permissions") or {}, table_id):
        raise HTTPException(status_code=403, detail=f"No write access to {table_id}")


def _filter_tables(user: dict[str, Any] | None, tables: list[dict]) -> list[dict]:
    if user is None:
        return tables
    allowed = set(user.get("tables") or [])
    return [t for t in tables if t.get("id") in allowed]


class CompinfoPrepStatusBody(BaseModel):
    status: str = Field(..., min_length=1)
    compid: str | None = None
    token: str | None = None


class WoMaterialLineBody(BaseModel):
    item: str = Field(..., min_length=1, max_length=15)
    qty_requested: float = Field(..., gt=0)


class WoMaterialAllocateBody(BaseModel):
    item: str = Field(..., min_length=1, max_length=15)
    qty: float | None = Field(None, gt=0)


class StockQtyBody(BaseModel):
    item: str = Field(..., min_length=1, max_length=15)
    qty: float = Field(..., gt=0)


class RefurbBody(StockQtyBody):
    from_available: bool = True


class TruckLoadBody(StockQtyBody):
    assignid: str = Field(..., min_length=1, max_length=40)


@router.get("/health")
def health():
    return emaint_demo_service.health_check()


@router.get("/config")
def config(user: Annotated[dict[str, Any] | None, Depends(require_demo_user)]):
    tables = _filter_tables(user, emaint_demo_service.list_tables())
    return {"tables": tables}


@router.get("/compinfo/prep-statuses")
def compinfo_prep_statuses(user: Annotated[dict[str, Any] | None, Depends(require_demo_user)]):
    _assert_read(user, "compinfo")
    return emaint_demo_service.list_compinfo_prep_statuses()


@router.get("/compinfo/resolve")
def compinfo_resolve(
    token: str = Query(..., min_length=1, max_length=200),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user, "compinfo")
    try:
        row = emaint_demo_service.resolve_compinfo(token)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="Asset not found")
    return {"asset": row, "prep_statuses": emaint_demo_service.list_compinfo_prep_statuses()}


@router.post("/compinfo/prep-status")
def compinfo_set_prep_status(
    body: CompinfoPrepStatusBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user, "compinfo")
    compid = (body.compid or "").strip()
    if not compid:
        token = (body.token or "").strip()
        if not token:
            raise HTTPException(status_code=400, detail="compid or token is required")
        try:
            row = emaint_demo_service.resolve_compinfo(token)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
        if row is None:
            raise HTTPException(status_code=404, detail="Asset not found")
        compid = str(row.get("compid") or "").strip()
        if not compid:
            raise HTTPException(status_code=404, detail="Asset has no compid")

    try:
        return emaint_demo_service.set_compinfo_prep_status(compid=compid, status=body.status)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/inventory/search")
def inventory_search(
    q: str | None = Query(None, max_length=200),
    limit: int = Query(25, ge=1, le=100),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user, "inventory")
    try:
        return wo_inventory_service.search_inventory(q=q, limit=limit)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/inventory/items/{item}/stock")
def inventory_item_stock(
    item: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user, "inventory")
    try:
        return wo_inventory_service.get_item_stock_summary(item)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/inventory/items/{item}/assignable")
def inventory_assignable_qty(
    item: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user, "inventory")
    try:
        return wo_inventory_service.get_assignable_qty(item)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/work-orders/{wo_key}/materials")
def wo_list_materials(
    wo_key: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user, "work_orders")
    try:
        return wo_inventory_service.list_materials(wo_key)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/work-orders/{wo_key}/materials")
def wo_add_material_line(
    wo_key: str,
    body: WoMaterialLineBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user, "inventory")
    try:
        return wo_inventory_service.upsert_material_line(
            wo_key=wo_key,
            item=body.item.strip(),
            qty_requested=body.qty_requested,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/work-orders/{wo_key}/materials/allocate")
def wo_allocate_material(
    wo_key: str,
    body: WoMaterialAllocateBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user, "inventory")
    email = (user or {}).get("email") if user else None
    try:
        return wo_inventory_service.allocate_material(
            wo_key=wo_key,
            item=body.item.strip(),
            qty=body.qty,
            created_by=email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/inventory/refurb")
def inventory_move_refurb(
    body: RefurbBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user, "inventory")
    email = (user or {}).get("email") if user else None
    try:
        return wo_inventory_service.move_to_refurb(
            item=body.item.strip(),
            qty=body.qty,
            from_available=body.from_available,
            created_by=email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/inventory/truck-load")
def inventory_truck_load(
    body: TruckLoadBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user, "inventory")
    email = (user or {}).get("email") if user else None
    try:
        return wo_inventory_service.load_truck(
            assignid=body.assignid.strip(),
            item=body.item.strip(),
            qty=body.qty,
            created_by=email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/field-techs")
def list_field_techs(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    q: str | None = Query(None, max_length=200),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user, "field_techs")
    try:
        return wo_inventory_service.list_field_techs(q=q, limit=limit, offset=offset)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/tech-truck/{assignid}")
def tech_truck_stock(
    assignid: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user, "inventory")
    try:
        return wo_inventory_service.list_truck_stock(assignid)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{table_id}/rows")
def list_rows(
    table_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    q: str | None = Query(None, max_length=200),
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user, table_id)
    try:
        return emaint_demo_service.browse_rows(table_id, limit=limit, offset=offset, q=q)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown table: {table_id}") from None
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{table_id}/rows/{key}/children/{child_id}")
def get_child_rows(
    table_id: str,
    key: str,
    child_id: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user, table_id)
    try:
        data = emaint_demo_service.browse_child_rows(table_id, key, child_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Not found") from None
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if data is None:
        raise HTTPException(status_code=404, detail="Row not found")
    return data


@router.get("/{table_id}/rows/{key}")
def get_row(
    table_id: str,
    key: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_read(user, table_id)
    try:
        row = emaint_demo_service.get_row(table_id, key)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown table: {table_id}") from None
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if row is None:
        raise HTTPException(status_code=404, detail="Row not found")
    return row


@router.patch("/{table_id}/rows/{key}")
def patch_row(
    table_id: str,
    key: str,
    body: RowPatchBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)] = None,
):
    _assert_write(user, table_id)
    try:
        return emaint_demo_service.patch_row(table_id, key, body.updates)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown table: {table_id}") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
