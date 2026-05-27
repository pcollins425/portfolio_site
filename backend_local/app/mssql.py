"""Minimal MSSQL access for dashboard and field API routes (pymssql)."""

from __future__ import annotations

import os
from typing import Literal

import pymssql
from dotenv import load_dotenv

DbProfile = Literal["dashboard", "field"]


def _credentials(profile: DbProfile) -> tuple[str | None, str | None]:
    if profile == "field":
        user = (os.environ.get("MSSQL_FIELD_USER") or os.environ.get("MSSQL_USER") or "").strip()
        password = os.environ.get("MSSQL_FIELD_PASSWORD") or os.environ.get("MSSQL_PASSWORD")
        return user or None, password
    user = (os.environ.get("MSSQL_USER") or "").strip()
    password = os.environ.get("MSSQL_PASSWORD")
    return user or None, password


def get_connection(
    database: str | None = None,
    *,
    profile: DbProfile = "dashboard",
    load_env: bool = True,
) -> pymssql.Connection:
    if load_env:
        load_dotenv(override=True)
    host = (os.environ.get("MSSQL_EXTERNAL") or os.environ.get("MSSQL_HOST") or "").strip()
    user, password = _credentials(profile)
    return pymssql.connect(
        server=host,
        user=user,
        password=password,
        database=database or os.environ.get("MSSQL_DATABASE"),
        port=os.environ.get("MSSQL_PORT", "1433"),
    )


def query(
    sql: str,
    params=None,
    *,
    database: str | None = None,
    profile: DbProfile = "dashboard",
    load_env: bool = True,
) -> list[dict]:
    conn = get_connection(database=database, profile=profile, load_env=load_env)
    try:
        cursor = conn.cursor(as_dict=True)
        cursor.execute(sql, params)
        return cursor.fetchall()
    finally:
        conn.close()
