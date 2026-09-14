"""Active employee directory lookups (`employees.employee_roles`)."""

from __future__ import annotations

import os
from typing import Any

from app import mssql

_ACTIVE_WITH_EMAIL = """
    er.active = 1
    AND NULLIF(LTRIM(RTRIM(er.email)), N'') IS NOT NULL
"""


def _catalog() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _row(row: dict[str, Any]) -> dict[str, str]:
    email = (row.get("email") or "").strip()
    name = (row.get("name") or "").strip() or email
    return {
        "employee_id": str(row.get("employee_id") or "").strip(),
        "name": name,
        "email": email,
    }


def list_directory(q: str = "", limit: int = 80) -> list[dict[str, str]]:
    search = (q or "").strip()
    limit = max(1, min(int(limit), 200))
    sql = f"""
        SELECT TOP {limit}
            er.reference_key AS employee_id,
            er.name,
            er.email
        FROM employees.employee_roles er
        WHERE {_ACTIVE_WITH_EMAIL}
    """
    params: list[str] = []
    if search:
        like = f"%{search}%"
        sql += """
          AND (
            er.name LIKE %s
            OR er.email LIKE %s
            OR er.reference_key LIKE %s
          )
        """
        params.extend([like, like, like])
    sql += " ORDER BY er.name"
    rows = mssql.query(
        sql,
        tuple(params),
        database=_catalog(),
        profile="dashboard",
        load_env=False,
    )
    return [_row(r) for r in rows]


def by_id(employee_id: str) -> dict[str, str] | None:
    eid = (employee_id or "").strip()
    if not eid:
        return None
    rows = mssql.query(
        f"""
        SELECT TOP 1
            er.reference_key AS employee_id,
            er.name,
            er.email
        FROM employees.employee_roles er
        WHERE {_ACTIVE_WITH_EMAIL}
          AND er.reference_key = %s
        """,
        (eid,),
        database=_catalog(),
        profile="dashboard",
        load_env=False,
    )
    return _row(rows[0]) if rows else None


def by_email(email: str) -> dict[str, str] | None:
    addr = (email or "").strip()
    if not addr or "@" not in addr:
        return None
    rows = mssql.query(
        f"""
        SELECT TOP 1
            er.reference_key AS employee_id,
            er.name,
            er.email
        FROM employees.employee_roles er
        WHERE {_ACTIVE_WITH_EMAIL}
          AND LOWER(LTRIM(RTRIM(er.email))) = LOWER(LTRIM(RTRIM(%s)))
        """,
        (addr,),
        database=_catalog(),
        profile="dashboard",
        load_env=False,
    )
    return _row(rows[0]) if rows else None
