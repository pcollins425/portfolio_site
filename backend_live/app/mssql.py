"""Minimal MSSQL access for dashboard routes (pymssql)."""

from __future__ import annotations

import os

import pymssql
from dotenv import load_dotenv


def get_connection(database: str | None = None, *, load_env: bool = True) -> pymssql.Connection:
    if load_env:
        load_dotenv(override=True)
    host = (os.environ.get("MSSQL_EXTERNAL") or os.environ.get("MSSQL_HOST") or "").strip()
    return pymssql.connect(
        server=host,
        user=os.environ.get("MSSQL_USER"),
        password=os.environ.get("MSSQL_PASSWORD"),
        database=database or os.environ.get("MSSQL_DATABASE"),
        port=os.environ.get("MSSQL_PORT", "1433"),
    )


def query(
    sql: str,
    params=None,
    *,
    database: str | None = None,
    load_env: bool = True,
) -> list[dict]:
    conn = get_connection(database=database, load_env=load_env)
    try:
        cursor = conn.cursor(as_dict=True)
        cursor.execute(sql, params)
        return cursor.fetchall()
    finally:
        conn.close()
