"""eMaint replacement demo — browse grid + record form; inventory attributes PATCH."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app import emaint_demo_service

router = APIRouter(prefix="/api/emaint-demo", tags=["emaint-demo"])


class RowPatchBody(BaseModel):
    updates: dict[str, Any] = Field(..., min_length=1)


@router.get("/health")
def health():
    return emaint_demo_service.health_check()


@router.get("/config")
def config():
    return {"tables": emaint_demo_service.list_tables()}


@router.get("/{table_id}/rows")
def list_rows(
    table_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    q: str | None = Query(None, max_length=200),
):
    try:
        return emaint_demo_service.browse_rows(table_id, limit=limit, offset=offset, q=q)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown table: {table_id}") from None
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/{table_id}/rows/{key}/children/{child_id}")
def get_child_rows(table_id: str, key: str, child_id: str):
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
def get_row(table_id: str, key: str):
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
def patch_row(table_id: str, key: str, body: RowPatchBody):
    try:
        return emaint_demo_service.patch_row(table_id, key, body.updates)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"Unknown table: {table_id}") from None
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
