"""Shared MSSQL helpers for page_chat runners (field profile)."""

from __future__ import annotations

import os
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from app import mssql


def catalog() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def query(sql: str, params: tuple[Any, ...] | list[Any] | None = None) -> list[dict[str, Any]]:
    return mssql.query(
        sql,
        params=params,
        database=catalog(),
        profile="field",
        load_env=False,
    )


def json_value(v: Any) -> Any:
    if isinstance(v, datetime):
        return v.date().isoformat() if v else None
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, bool):
        return v
    if v is None:
        return None
    return v
