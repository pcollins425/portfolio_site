"""Casino row scope for Technicians.

``clients.casinos.techs`` is an ordered list: ``1. EMP-000105`` is the primary,
``2.`` onward are licensed there. A Technician sees a casino when their EMP
key is anywhere in that list. Other roles are not narrowed. Dev view uses the
previewed person's role and employee id.
"""

from __future__ import annotations

import re
from typing import Any

TECHNICIAN_ROLE = "Technician"
_EMP_KEY = re.compile(r"\bEMP-\d{6}\b")


def assigned_employee_id(user: dict[str, Any] | None) -> str | None:
    """EMP key to filter on, or None when this request sees every casino."""
    if not user:
        return None
    view = user.get("view_as")
    if isinstance(view, dict) and (view.get("employee_id") or "").strip():
        role = view.get("role")
        employee_id = view.get("employee_id")
    else:
        role = user.get("role")
        employee_id = user.get("employee_id")
    role_name = (role or "").strip()
    emp = (employee_id or "").strip()
    if role_name != TECHNICIAN_ROLE or not _EMP_KEY.fullmatch(emp):
        return None
    return emp


def blob_includes(blob: str | None, employee_id: str) -> bool:
    return employee_id in _EMP_KEY.findall(blob or "")


def sql_predicate(alias: str = "c") -> str:
    """True when ``alias.techs`` contains the employee id as its own token.

    The stored form is ``1. EMP-000105`` or ``1. EMP-000105, 2. EMP-000088``.
    The id is always preceded by a space. Two LIKE arms cover end-of-string
    and a following comma so ``EMP-000105`` does not match a longer token.
    """
    return f"({alias}.techs LIKE %s OR {alias}.techs LIKE %s)"


def sql_params(employee_id: str) -> tuple[str, str]:
    return (f"% {employee_id}", f"% {employee_id},%")
