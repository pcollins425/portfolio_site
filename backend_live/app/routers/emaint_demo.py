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
