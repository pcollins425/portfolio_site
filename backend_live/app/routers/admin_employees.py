"""Admin Employees / Roles API — permission-gated, no user-named hardcodes."""

from __future__ import annotations

import os
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app import mssql
from app import permission_catalog as cat
from app.auth_deps import require_demo_user

router = APIRouter(prefix="/api/admin", tags=["admin-employees"])


def _db() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _q(sql: str, params=None) -> list[dict]:
    return mssql.query(sql, params=params, database=_db(), profile="field", load_env=False)


def _exec(sql: str, params=None) -> int:
    return mssql.execute(sql, params=params, database=_db(), profile="field", load_env=False)


def _perms(user: dict[str, Any] | None) -> dict[str, str]:
    if user is None:
        return {}
    raw = user.get("permissions") or {}
    return raw if isinstance(raw, dict) else cat.parse_permissions_blob(str(raw))


def _require_user(user: dict[str, Any] | None) -> dict[str, Any]:
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in required")
    return user


def _actor_name(user: dict[str, Any]) -> str:
    return (user.get("name") or user.get("email") or "admin").strip()[:50]


def _role_row(ref: str) -> dict[str, Any] | None:
    rows = _q(
        """
        SELECT TOP 1
            r.reference_key,
            r.role,
            r.permissions,
            r.index_key,
            r.update_date,
            r.update_by
        FROM employees.roles r
        WHERE r.reference_key = %s
        """,
        (ref,),
    )
    return rows[0] if rows else None


def _employee_row(ref: str) -> dict[str, Any] | None:
    rows = _q(
        """
        SELECT TOP 1
            er.reference_key,
            er.first_name,
            er.last_name,
            er.name,
            er.email,
            er.role_id,
            er.active,
            er.override_permissions,
            er.combined_permissions,
            er.index_key,
            er.update_date,
            er.update_by,
            r.role AS role_name,
            r.permissions AS role_permissions
        FROM employees.employee_roles er
        LEFT JOIN employees.roles r ON r.reference_key = er.role_id
        WHERE er.reference_key = %s
        """,
        (ref,),
    )
    return rows[0] if rows else None


def _all_employee_perm_rows() -> list[dict[str, Any]]:
    return _q(
        """
        SELECT
            er.reference_key,
            er.active,
            er.override_permissions,
            r.permissions AS role_permissions
        FROM employees.employee_roles er
        LEFT JOIN employees.roles r ON r.reference_key = er.role_id
        """
    )


def _employee_payload(row: dict[str, Any]) -> dict[str, Any]:
    role_blob = row.get("role_permissions")
    override_blob = row.get("override_permissions")
    role_map = cat.parse_permissions_blob(role_blob)
    override_map = cat.parse_permissions_blob(override_blob)
    effective = cat.merge_permissions(role_blob, override_blob)
    active = row.get("active")
    if isinstance(active, bool):
        active_bit = active
    else:
        active_bit = bool(active) if active is not None else False
    return {
        "reference_key": row.get("reference_key"),
        "first_name": row.get("first_name"),
        "last_name": row.get("last_name"),
        "name": row.get("name"),
        "email": row.get("email"),
        "role_id": row.get("role_id"),
        "role_name": row.get("role_name"),
        "active": active_bit,
        "override_permissions": override_blob or "",
        "override_map": override_map,
        "role_permissions": role_blob or "",
        "role_map": role_map,
        "effective": effective,
        "combined_permissions": row.get("combined_permissions") or "",
        "update_date": str(row.get("update_date") or ""),
        "update_by": row.get("update_by"),
    }


def _role_payload(row: dict[str, Any]) -> dict[str, Any]:
    blob = row.get("permissions") or ""
    return {
        "reference_key": row.get("reference_key"),
        "role": row.get("role"),
        "permissions": blob,
        "permission_map": cat.parse_permissions_blob(blob),
        "update_date": str(row.get("update_date") or ""),
        "update_by": row.get("update_by"),
    }


def _ensure_not_last_admin(
    area: str,
    *,
    hypothetical: list[dict[str, Any]],
) -> None:
    if cat.count_active_with_write(hypothetical, area) < 1:
        raise HTTPException(
            status_code=400,
            detail=f"Refusing change that would leave zero active users with {area} write access",
        )


def _apply_employee_hypothesis(
    rows: list[dict[str, Any]],
    ref: str,
    *,
    override_blob: str | None = None,
    role_id: str | None = None,
    active: bool | None = None,
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    role_perms_by_id: dict[str, str] = {}
    for r in _q("SELECT reference_key, permissions FROM employees.roles"):
        role_perms_by_id[str(r["reference_key"])] = r.get("permissions") or ""

    for row in rows:
        copy = dict(row)
        if str(copy.get("reference_key")) == ref:
            if override_blob is not None:
                copy["override_permissions"] = override_blob
            if role_id is not None:
                copy["role_permissions"] = role_perms_by_id.get(role_id, "")
            if active is not None:
                copy["active"] = active
        out.append(copy)
    return out


class EmployeePatch(BaseModel):
    name: str | None = Field(default=None, max_length=50)
    first_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    email: str | None = Field(default=None, max_length=50)
    role_id: str | None = Field(default=None, max_length=25)
    active: bool | None = None
    # area -> level | "NONE" | null (null = drop override, use role default)
    override_map: dict[str, str | None] | None = None
    # Alternate: desired effective map; server computes deltas vs role
    effective_map: dict[str, str | None] | None = None


class RolePatch(BaseModel):
    role: str | None = Field(default=None, max_length=50)
    permission_map: dict[str, str | None] | None = None


class ResetBody(BaseModel):
    confirm: bool = False


@router.get("/permission-catalog")
def get_catalog(user: Annotated[dict[str, Any] | None, Depends(require_demo_user)]):
    user = _require_user(user)
    perms = _perms(user)
    if not (cat.has_employees_read(perms) or cat.has_roles_read(perms)):
        raise HTTPException(status_code=403, detail="No employees/roles read access")
    payload = cat.catalog_payload()
    payload["actor"] = {
        "effective": perms,
        "employees_read": cat.has_employees_read(perms),
        "employees_write": cat.has_employees_write(perms),
        "employees_add": cat.can_add_employees(perms),
        "roles_read": cat.has_roles_read(perms),
        "roles_write": cat.has_roles_write(perms),
        "roles_add": cat.can_add_roles(perms),
        "grantable": {
            area.id: sorted(cat.levels_actor_may_grant(perms.get(area.id)))
            for area in cat.PERMISSION_CATALOG
        },
    }
    return payload


@router.get("/employees")
def list_employees(
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)],
    q: str = Query("", max_length=80),
    active: str | None = Query(None, description="1|0|all"),
    limit: int = Query(200, ge=1, le=500),
):
    user = _require_user(user)
    if not cat.has_employees_read(_perms(user)):
        raise HTTPException(status_code=403, detail="No employees read access")

    sql = """
        SELECT TOP {limit}
            er.reference_key,
            er.first_name,
            er.last_name,
            er.name,
            er.email,
            er.role_id,
            er.active,
            er.override_permissions,
            er.combined_permissions,
            er.update_date,
            er.update_by,
            r.role AS role_name,
            r.permissions AS role_permissions
        FROM employees.employee_roles er
        LEFT JOIN employees.roles r ON r.reference_key = er.role_id
        WHERE 1=1
    """.format(limit=int(limit))
    params: list[Any] = []
    flag = (active or "all").strip().lower()
    if flag in ("1", "true", "yes"):
        sql += " AND er.active = 1"
    elif flag in ("0", "false", "no"):
        sql += " AND (er.active = 0 OR er.active IS NULL)"
    search = (q or "").strip()
    if search:
        like = f"%{search}%"
        sql += """
          AND (
            er.name LIKE %s OR er.email LIKE %s OR er.reference_key LIKE %s
            OR er.first_name LIKE %s OR er.last_name LIKE %s
          )
        """
        params.extend([like, like, like, like, like])
    sql += " ORDER BY er.name, er.reference_key"
    rows = _q(sql, tuple(params))
    return {"employees": [_employee_payload(r) for r in rows]}


@router.get("/employees/{ref}")
def get_employee(
    ref: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)],
):
    user = _require_user(user)
    if not cat.has_employees_read(_perms(user)):
        raise HTTPException(status_code=403, detail="No employees read access")
    row = _employee_row(ref.strip())
    if not row:
        raise HTTPException(status_code=404, detail="Employee not found")
    return _employee_payload(row)


@router.patch("/employees/{ref}")
def patch_employee(
    ref: str,
    body: EmployeePatch,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)],
):
    user = _require_user(user)
    actor = _perms(user)
    if not cat.has_employees_write(actor):
        raise HTTPException(status_code=403, detail="No employees write access")

    ref = ref.strip()
    row = _employee_row(ref)
    if not row:
        raise HTTPException(status_code=404, detail="Employee not found")

    role_id = body.role_id if body.role_id is not None else row.get("role_id")
    role = _role_row(str(role_id)) if role_id else None
    if role_id and not role:
        raise HTTPException(status_code=400, detail=f"Unknown role_id {role_id}")

    role_blob = (role or {}).get("permissions") if role else row.get("role_permissions")
    role_map = cat.parse_permissions_blob(role_blob)

    new_override_blob = row.get("override_permissions") or ""
    if body.effective_map is not None:
        deltas = cat.overrides_from_effective(role_map, body.effective_map)
        errs = cat.validate_grant_map(actor, {k: v for k, v in deltas.items()})
        # Also validate raises vs prior effective for areas being set in effective_map
        for area, level in body.effective_map.items():
            if level is None or str(level).upper() in ("", "OFF", cat.LEVEL_NONE):
                continue
            if not cat.can_grant(actor, area, str(level)):
                errs.append(f"Cannot grant {area}: {level} (you hold {actor.get(area) or 'none'})")
        if errs:
            raise HTTPException(status_code=403, detail="; ".join(errs))
        new_override_blob = cat.serialize_permissions(deltas)
    elif body.override_map is not None:
        current = cat.parse_permissions_blob(new_override_blob)
        for area, level in body.override_map.items():
            if level is None:
                current.pop(area, None)
            else:
                current[area] = level
        errs = cat.validate_grant_map(actor, {k: v for k, v in body.override_map.items() if v is not None})
        if errs:
            raise HTTPException(status_code=403, detail="; ".join(errs))
        new_override_blob = cat.serialize_permissions(current)

    new_active = body.active if body.active is not None else bool(row.get("active"))
    hypo = _apply_employee_hypothesis(
        _all_employee_perm_rows(),
        ref,
        override_blob=new_override_blob,
        role_id=str(role_id) if role_id else None,
        active=new_active,
    )
    _ensure_not_last_admin(cat.EMPLOYEES_AREA, hypothetical=hypo)

    effective = cat.merge_permissions(role_blob, new_override_blob)
    combined = cat.serialize_permissions(effective)
    now = datetime.now()
    actor_name = _actor_name(user)

    name = body.name if body.name is not None else row.get("name")
    first_name = body.first_name if body.first_name is not None else row.get("first_name")
    last_name = body.last_name if body.last_name is not None else row.get("last_name")
    email = body.email if body.email is not None else row.get("email")
    if name is None and (first_name or last_name):
        name = f"{first_name or ''} {last_name or ''}".strip()

    _exec(
        """
        UPDATE employees.employee_roles
        SET
            name = %s,
            first_name = %s,
            last_name = %s,
            email = %s,
            role_id = %s,
            active = %s,
            override_permissions = %s,
            combined_permissions = %s,
            update_date = %s,
            update_by = %s
        WHERE reference_key = %s
        """,
        (
            name,
            first_name,
            last_name,
            email,
            role_id,
            1 if new_active else 0,
            new_override_blob or None,
            combined or None,
            now,
            actor_name,
            ref,
        ),
    )
    updated = _employee_row(ref)
    return _employee_payload(updated)  # type: ignore[arg-type]


@router.post("/employees/{ref}/reset-overrides")
def reset_overrides(
    ref: str,
    body: ResetBody,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)],
):
    user = _require_user(user)
    actor = _perms(user)
    if not cat.has_employees_write(actor):
        raise HTTPException(status_code=403, detail="No employees write access")
    if not body.confirm:
        raise HTTPException(
            status_code=400,
            detail="confirm=true required — resets personal overrides to the role base",
        )

    ref = ref.strip()
    row = _employee_row(ref)
    if not row:
        raise HTTPException(status_code=404, detail="Employee not found")

    role_blob = row.get("role_permissions")
    hypo = _apply_employee_hypothesis(
        _all_employee_perm_rows(),
        ref,
        override_blob="",
        active=bool(row.get("active")),
    )
    _ensure_not_last_admin(cat.EMPLOYEES_AREA, hypothetical=hypo)

    combined = cat.serialize_permissions(cat.parse_permissions_blob(role_blob))
    _exec(
        """
        UPDATE employees.employee_roles
        SET
            override_permissions = NULL,
            combined_permissions = %s,
            update_date = %s,
            update_by = %s
        WHERE reference_key = %s
        """,
        (combined or None, datetime.now(), _actor_name(user), ref),
    )
    return _employee_payload(_employee_row(ref))  # type: ignore[arg-type]


@router.get("/roles")
def list_roles(user: Annotated[dict[str, Any] | None, Depends(require_demo_user)]):
    user = _require_user(user)
    if not cat.has_roles_read(_perms(user)):
        raise HTTPException(status_code=403, detail="No roles read access")
    rows = _q(
        """
        SELECT
            r.reference_key,
            r.role,
            r.permissions,
            r.update_date,
            r.update_by
        FROM employees.roles r
        ORDER BY r.role, r.reference_key
        """
    )
    return {"roles": [_role_payload(r) for r in rows]}


@router.get("/roles/{ref}")
def get_role(
    ref: str,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)],
):
    user = _require_user(user)
    if not cat.has_roles_read(_perms(user)):
        raise HTTPException(status_code=403, detail="No roles read access")
    row = _role_row(ref.strip())
    if not row:
        raise HTTPException(status_code=404, detail="Role not found")
    return _role_payload(row)


@router.patch("/roles/{ref}")
def patch_role(
    ref: str,
    body: RolePatch,
    user: Annotated[dict[str, Any] | None, Depends(require_demo_user)],
):
    user = _require_user(user)
    actor = _perms(user)
    if not cat.has_roles_write(actor):
        raise HTTPException(status_code=403, detail="No roles write access")

    ref = ref.strip()
    row = _role_row(ref)
    if not row:
        raise HTTPException(status_code=404, detail="Role not found")

    current = cat.parse_permissions_blob(row.get("permissions"))
    if body.permission_map is not None:
        for area, level in body.permission_map.items():
            if level is None or str(level).upper() in ("", "OFF", cat.LEVEL_NONE):
                current.pop(area, None)
            else:
                current[area] = str(level).strip()
        errs = cat.validate_grant_map(
            actor,
            {k: v for k, v in body.permission_map.items() if v is not None},
        )
        if errs:
            raise HTTPException(status_code=403, detail="; ".join(errs))

    # Role templates never store NONE.
    clean = {k: v for k, v in current.items() if v and v.upper() != cat.LEVEL_NONE}
    new_blob = cat.serialize_permissions(clean)

    # Hypothesize: everyone on this role gets new role_permissions; keep overrides.
    people = _all_employee_perm_rows()
    hypo: list[dict[str, Any]] = []
    for p in people:
        copy = dict(p)
        # Re-fetch role_id via join — rows don't include role_id; reload
        hypo.append(copy)

    # Load role assignments
    assigned = _q(
        """
        SELECT er.reference_key, er.active, er.override_permissions, er.role_id
        FROM employees.employee_roles er
        """
    )
    hypo = []
    for p in assigned:
        copy = {
            "reference_key": p["reference_key"],
            "active": p.get("active"),
            "override_permissions": p.get("override_permissions"),
            "role_permissions": new_blob if str(p.get("role_id")) == ref else None,
        }
        if copy["role_permissions"] is None:
            # keep prior from full join
            prior = next(
                (x for x in people if str(x.get("reference_key")) == str(p.get("reference_key"))),
                None,
            )
            copy["role_permissions"] = (prior or {}).get("role_permissions")
        hypo.append(copy)

    _ensure_not_last_admin(cat.EMPLOYEES_AREA, hypothetical=hypo)
    _ensure_not_last_admin(cat.ROLES_AREA, hypothetical=hypo)

    role_name = body.role if body.role is not None else row.get("role")
    _exec(
        """
        UPDATE employees.roles
        SET
            role = %s,
            permissions = %s,
            update_date = %s,
            update_by = %s
        WHERE reference_key = %s
        """,
        (role_name, new_blob or None, datetime.now(), _actor_name(user), ref),
    )

    # Refresh combined_permissions for assignees so AppSheet stays aligned.
    for p in assigned:
        if str(p.get("role_id")) != ref:
            continue
        eff = cat.merge_permissions(new_blob, p.get("override_permissions"))
        _exec(
            """
            UPDATE employees.employee_roles
            SET combined_permissions = %s, update_date = %s, update_by = %s
            WHERE reference_key = %s
            """,
            (
                cat.serialize_permissions(eff) or None,
                datetime.now(),
                _actor_name(user),
                p["reference_key"],
            ),
        )

    return _role_payload(_role_row(ref))  # type: ignore[arg-type]
