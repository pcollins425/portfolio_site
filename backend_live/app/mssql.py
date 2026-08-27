"""Minimal MSSQL access for dashboard and field API routes (pymssql).

By default, connections are reused via DBUtils PooledDB (one pool per
profile + database). Set MSSQL_POOL_ENABLED=0 to restore connect-per-query.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Any, Literal

import pymssql
from dotenv import load_dotenv

DbProfile = Literal["dashboard", "field"]

_log = logging.getLogger("app.mssql")
_pools_lock = threading.Lock()
_pools: dict[tuple[str, str, str, str, str], Any] = {}


def _credentials(profile: DbProfile) -> tuple[str | None, str | None]:
    if profile == "field":
        user = (os.environ.get("MSSQL_FIELD_USER") or os.environ.get("MSSQL_USER") or "").strip()
        password = os.environ.get("MSSQL_FIELD_PASSWORD") or os.environ.get("MSSQL_PASSWORD")
        return user or None, password
    user = (os.environ.get("MSSQL_USER") or "").strip()
    password = os.environ.get("MSSQL_PASSWORD")
    return user or None, password


def _pool_enabled() -> bool:
    return (os.environ.get("MSSQL_POOL_ENABLED") or "1").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def _pool_max() -> int:
    try:
        return max(1, int((os.environ.get("MSSQL_POOL_MAX") or "5").strip()))
    except ValueError:
        return 5


def _host() -> str:
    return (os.environ.get("MSSQL_EXTERNAL") or os.environ.get("MSSQL_HOST") or "").strip()


def _port() -> str:
    return (os.environ.get("MSSQL_PORT") or "1433").strip() or "1433"


def _resolved_database(database: str | None) -> str:
    return (database or os.environ.get("MSSQL_DATABASE") or "").strip()


def _connect_kwargs(
    database: str | None,
    *,
    profile: DbProfile,
) -> dict[str, Any]:
    user, password = _credentials(profile)
    return {
        "server": _host(),
        "user": user,
        "password": password,
        "database": _resolved_database(database) or None,
        "port": _port(),
    }


def _pool_key(profile: DbProfile, database: str | None) -> tuple[str, str, str, str, str]:
    user, _ = _credentials(profile)
    return (profile, _host(), _port(), user or "", _resolved_database(database))


def _get_pool(profile: DbProfile, database: str | None):
    key = _pool_key(profile, database)
    with _pools_lock:
        pool = _pools.get(key)
        if pool is not None:
            return pool
        from dbutils.pooled_db import PooledDB

        maxconn = _pool_max()
        kwargs = _connect_kwargs(database, profile=profile)
        # pymssql has no Connection.ping(); SQL check replaces it (DBUtils docs).
        pool = PooledDB(
            creator=pymssql.connect,
            maxconnections=maxconn,
            mincached=0,
            maxcached=maxconn,
            blocking=True,
            ping=(1, "SELECT 1"),
            reset=True,
            **kwargs,
        )
        _pools[key] = pool
        _log.info(
            "mssql pool created profile=%s database=%s maxconnections=%s",
            profile,
            kwargs.get("database"),
            maxconn,
        )
        return pool


def close_pools() -> None:
    """Drop all pools (e.g. on API shutdown). Safe to call repeatedly."""
    with _pools_lock:
        pools = list(_pools.values())
        _pools.clear()
    for pool in pools:
        try:
            pool.close()
        except Exception:
            _log.exception("mssql pool close failed")


def get_connection(
    database: str | None = None,
    *,
    profile: DbProfile = "dashboard",
    load_env: bool = True,
) -> pymssql.Connection:
    if load_env:
        load_dotenv(override=True)
    if not _pool_enabled():
        return pymssql.connect(**_connect_kwargs(database, profile=profile))
    # SteadyDB/PooledDB wrapper: .close() returns the connection to the pool.
    return _get_pool(profile, database).connection()


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


def execute(
    sql: str,
    params=None,
    *,
    database: str | None = None,
    profile: DbProfile = "dashboard",
    load_env: bool = True,
) -> int:
    conn = get_connection(database=database, profile=profile, load_env=load_env)
    try:
        cursor = conn.cursor()
        cursor.execute(sql, params)
        conn.commit()
        return cursor.rowcount
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        raise
    finally:
        conn.close()


def query_many(
    statements: list[tuple[str, tuple | None]],
    *,
    database: str | None = None,
    profile: DbProfile = "dashboard",
    load_env: bool = True,
) -> list[list[dict]]:
    """Run multiple SELECTs on one connection (one checkout / return)."""
    conn = get_connection(database=database, profile=profile, load_env=load_env)
    try:
        cursor = conn.cursor(as_dict=True)
        results: list[list[dict]] = []
        for sql, params in statements:
            cursor.execute(sql, params)
            results.append(cursor.fetchall())
        return results
    finally:
        conn.close()
