"""Finance expenses browse API — finance.expenses + card_accounts."""

from __future__ import annotations

import math
import os
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app import mssql

router = APIRouter(prefix="/api/expenses", tags=["expenses"])

_EXPENSE_ACCOUNT_JOIN = """
LEFT JOIN finance.expense_account_gl_display ead
    ON ead.gl_code = CASE
        WHEN e.expense_account IS NOT NULL
            AND CHARINDEX(N' -', e.expense_account + N' -') > 1
        THEN LEFT(e.expense_account, CHARINDEX(N' -', e.expense_account + N' -') - 1)
        ELSE NULL
    END
"""

_EMPLOYEE_NAME_SQL = """
COALESCE(
    NULLIF(LTRIM(RTRIM(er.name)), ''),
    NULLIF(LTRIM(RTRIM(CONCAT(er.first_name, N' ', er.last_name))), ''),
    e.employee_id
)
"""


def _catalog() -> str:
    return (os.environ.get("MSSQL_DATABASE") or "dgs_application_db").strip()


def _field_query(sql: str, params=None):
    return mssql.query(
        sql,
        params=params,
        database=_catalog(),
        profile="field",
        load_env=False,
    )


def _json_value(v):
    if isinstance(v, datetime):
        return v.date().isoformat() if v else None
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if v is None:
        return None
    return str(v).strip() if isinstance(v, str) else v


def _money(v) -> float | None:
    val = _json_value(v)
    if val is None:
        return None
    return float(val)


def _parse_iso_date(value: str | None, field: str) -> date | None:
    if not value or not value.strip():
        return None
    try:
        return date.fromisoformat(value.strip())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {field}; use YYYY-MM-DD") from exc


def _list_filters(
    *,
    cardholder: str | None,
    date_from: date | None,
    date_to: date | None,
    q: str | None,
) -> tuple[str, tuple]:
    clauses: list[str] = []
    params: list = []

    if cardholder:
        clauses.append("e.employee_id = %s")
        params.append(cardholder.strip())

    if date_from is not None:
        clauses.append("e.date >= %s")
        params.append(date_from)

    if date_to is not None:
        clauses.append("e.date <= %s")
        params.append(date_to)

    if q:
        like = f"%{q.strip()}%"
        clauses.append(
            """
            (
                e.reference_key LIKE %s
                OR e.description LIKE %s
                OR e.expense_account LIKE %s
                OR e.comments LIKE %s
                OR CAST(e.amount AS VARCHAR(32)) LIKE %s
            )
            """
        )
        params.extend([like, like, like, like, like])

    if not clauses:
        return "", tuple()
    return " AND " + " AND ".join(clauses), tuple(params)


def _row_payload(r: dict) -> dict:
    receipt = _json_value(r.get("receipt"))
    amex_id = _json_value(r.get("amex_id"))
    return {
        "reference_key": _json_value(r.get("reference_key")),
        "date": _json_value(r.get("date")),
        "amount": _money(r.get("amount")),
        "employee_id": _json_value(r.get("employee_id")),
        "employee_name": _json_value(r.get("employee_name")),
        "state_abbr": _json_value(r.get("state_abbr")),
        "tribe_name": _json_value(r.get("tribe_name")),
        "casino_name": _json_value(r.get("casino_name")),
        "expense_account": _json_value(r.get("expense_account")),
        "expense_account_display": _json_value(r.get("expense_account_display")),
        "description": _json_value(r.get("description")),
        "receipt": receipt,
        "has_receipt": bool(receipt),
        "amex_id": amex_id,
        "amex_matched": bool(amex_id),
        "comments": _json_value(r.get("comments")),
    }


@router.get("/health")
def expenses_health():
    catalog = _catalog()
    ok = False
    n = None
    try:
        row = _field_query("SELECT COUNT(*) AS n FROM finance.expenses")[0]
        n = int(row["n"])
        ok = True
    except Exception:
        pass
    ext = os.environ.get("MSSQL_EXTERNAL") or os.environ.get("MSSQL_HOST")
    return {
        "ok": ok,
        "database": catalog,
        "expense_count": n,
        "host": ext,
    }


@router.get("/cardholders")
def list_cardholders():
    """Active Amex cardholders from finance.card_accounts."""
    try:
        rows = _field_query(
            f"""
            SELECT
                ca.employee_id,
                ca.name_on_card,
                {_EMPLOYEE_NAME_SQL.replace('e.employee_id', 'ca.employee_id')} AS employee_name
            FROM finance.card_accounts ca
            LEFT JOIN employees.employee_roles er
                ON er.reference_key = ca.employee_id
            WHERE ca.active = 1
                AND ca.employee_id IS NOT NULL
            ORDER BY ca.name_on_card
            """
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    items = []
    for r in rows:
        employee_id = _json_value(r.get("employee_id"))
        if not employee_id:
            continue
        name_on_card = _json_value(r.get("name_on_card"))
        employee_name = _json_value(r.get("employee_name"))
        items.append(
            {
                "employee_id": employee_id,
                "name_on_card": name_on_card,
                "label": employee_name or name_on_card or employee_id,
            }
        )
    return {"items": items}


@router.get("")
def list_expenses(
    cardholder: str | None = Query(None, description="employee_id from card_accounts"),
    date_from: str | None = Query(None, description="Inclusive start date YYYY-MM-DD"),
    date_to: str | None = Query(None, description="Inclusive end date YYYY-MM-DD"),
    q: str = Query("", max_length=120, description="Search ref, description, amount, GL"),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=2000),
):
    """Paginated expense browse — newest date first."""
    parsed_from = _parse_iso_date(date_from, "date_from")
    parsed_to = _parse_iso_date(date_to, "date_to")
    if parsed_from and parsed_to and parsed_from > parsed_to:
        raise HTTPException(status_code=400, detail="date_from must be on or before date_to")

    filter_sql, filter_params = _list_filters(
        cardholder=cardholder,
        date_from=parsed_from,
        date_to=parsed_to,
        q=q.strip() or None,
    )

    try:
        count_row = _field_query(
            f"""
            SELECT
                COUNT(*) AS n,
                COALESCE(SUM(e.amount), 0) AS total_amount
            FROM finance.expenses e
            WHERE 1=1
            {filter_sql}
            """,
            filter_params,
        )[0]
        total = int(count_row["n"])
        total_amount = _money(count_row.get("total_amount")) or 0.0

        offset = (page - 1) * page_size
        rows = _field_query(
            f"""
            SELECT
                e.reference_key,
                e.date,
                e.amount,
                e.employee_id,
                {_EMPLOYEE_NAME_SQL} AS employee_name,
                s.state_abbreviation AS state_abbr,
                t.tribe_name,
                c.casino_name,
                e.expense_account,
                COALESCE(ead.display_name, e.expense_account) AS expense_account_display,
                e.description,
                e.receipt,
                e.amex_id,
                e.comments
            FROM finance.expenses e
            LEFT JOIN employees.employee_roles er
                ON er.reference_key = e.employee_id
            LEFT JOIN clients.states s
                ON s.reference_key = e.state_id
            LEFT JOIN clients.tribes t
                ON t.reference_key = e.tribe_id
            LEFT JOIN clients.casinos c
                ON c.reference_key = e.casino_id
            {_EXPENSE_ACCOUNT_JOIN}
            WHERE 1=1
            {filter_sql}
            ORDER BY e.date DESC, e.reference_key DESC
            OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY
            """,
            filter_params,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    items = [_row_payload(r) for r in rows]
    total_pages = max(1, math.ceil(total / page_size)) if total else 1

    return {
        "items": items,
        "cardholder": cardholder,
        "date_from": parsed_from.isoformat() if parsed_from else None,
        "date_to": parsed_to.isoformat() if parsed_to else None,
        "search": q.strip() or None,
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
        "total_amount": total_amount,
    }


class BatchExpenseUpdate(BaseModel):
    reference_key: str = Field(min_length=1, max_length=32)
    expense_account: str | None = Field(default=None, max_length=100)
    description: str | None = Field(default=None, max_length=500)


class BatchExpenseUpdateRequest(BaseModel):
    updates: list[BatchExpenseUpdate] = Field(min_length=1, max_length=500)


def _load_gl_lookup() -> tuple[dict[str, str], set[str]]:
    """Map normalized labels → gl_code; set of valid gl_code prefixes."""
    rows = _field_query(
        "SELECT gl_code, display_name FROM finance.expense_account_gl_display ORDER BY gl_code"
    )
    by_label: dict[str, str] = {}
    codes: set[str] = set()
    for r in rows:
        code = _json_value(r.get("gl_code"))
        display = _json_value(r.get("display_name"))
        if not code:
            continue
        codes.add(code.upper())
        by_label[code.upper()] = code
        if display:
            by_label[display.strip().upper()] = code
            if " - " not in display and display.upper().startswith(code.upper()):
                tail = display[len(code) :].strip()
                if tail:
                    by_label[f"{code} - {tail}".upper()] = code
    return by_label, codes


def _normalize_expense_account(raw: str | None, gl_by_label: dict[str, str], gl_codes: set[str]) -> str | None:
    if raw is None:
        return None
    value = raw.strip()
    if not value:
        return ""
    upper = value.upper()
    if upper in gl_by_label:
        matched = gl_by_label[upper]
        if value.upper().startswith(matched.upper()):
            return value
        return matched
    for code in sorted(gl_codes, key=len, reverse=True):
        if upper.startswith(code + " ") or upper.startswith(code + " -") or upper == code:
            return value
    return None


@router.get("/gl-accounts")
def list_gl_accounts():
    """GL labels for mass-edit autocomplete and paste validation."""
    try:
        rows = _field_query(
            """
            SELECT gl_code, display_name
            FROM finance.expense_account_gl_display
            ORDER BY display_name
            """
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    items = []
    labels: list[str] = []
    for r in rows:
        code = _json_value(r.get("gl_code"))
        display = _json_value(r.get("display_name"))
        if not code or not display:
            continue
        short = display
        if display.upper().startswith(code.upper()) and " - " not in display:
            tail = display[len(code) :].strip()
            if tail:
                short = f"{code} - {tail}"
        items.append({"gl_code": code, "display_name": display, "label": short})
        labels.append(display)
        if short != display:
            labels.append(short)
    seen: set[str] = set()
    source: list[str] = []
    for label in labels:
        if label not in seen:
            seen.add(label)
            source.append(label)
    return {"items": items, "source": source}


@router.post("/batch")
def batch_update_expenses(body: BatchExpenseUpdateRequest):
    """Apply spreadsheet mass-edit saves to finance.expenses."""
    gl_by_label, gl_codes = _load_gl_lookup()
    updated = 0
    errors: list[dict] = []

    for item in body.updates:
        key = item.reference_key.strip()
        if not key:
            errors.append({"reference_key": item.reference_key, "error": "reference_key required"})
            continue

        sets: list[str] = []
        params: list = []

        if item.expense_account is not None:
            normalized = _normalize_expense_account(item.expense_account, gl_by_label, gl_codes)
            if normalized is None:
                errors.append(
                    {
                        "reference_key": key,
                        "field": "expense_account",
                        "error": f"Unknown GL account: {item.expense_account}",
                    }
                )
                continue
            sets.append("expense_account = %s")
            params.append(normalized if normalized else None)

        if item.description is not None:
            sets.append("description = %s")
            params.append(item.description.strip() or None)

        if not sets:
            continue

        sets.append("update_date = GETDATE()")
        sets.append("update_by = %s")
        params.append("dgsapp-mass-edit")
        params.append(key)

        try:
            n = mssql.execute(
                f"""
                UPDATE finance.expenses
                SET {", ".join(sets)}
                WHERE reference_key = %s
                """,
                tuple(params),
                database=_catalog(),
                profile="field",
                load_env=False,
            )
            if n:
                updated += 1
            else:
                errors.append({"reference_key": key, "error": "expense not found"})
        except Exception as exc:
            errors.append({"reference_key": key, "error": str(exc)})

    if updated == 0 and errors:
        raise HTTPException(status_code=400, detail={"updated": 0, "errors": errors})

    return {"updated": updated, "errors": errors}


@router.get("/{reference_key}")
def get_expense(reference_key: str):
    """Single expense row for the detail drawer."""
    key = reference_key.strip()
    if not key:
        raise HTTPException(status_code=400, detail="reference_key is required")

    try:
        rows = _field_query(
            f"""
            SELECT
                e.reference_key,
                e.date,
                e.amount,
                e.employee_id,
                {_EMPLOYEE_NAME_SQL} AS employee_name,
                e.state_id,
                s.state_abbreviation AS state_abbr,
                s.state AS state_name,
                e.tribe_id,
                t.tribe_name,
                e.casino_id,
                c.casino_name,
                e.expense_account,
                COALESCE(ead.display_name, e.expense_account) AS expense_account_display,
                e.description,
                e.comments,
                e.receipt,
                e.amex_id,
                e.override_receipt,
                e.insert_date,
                e.update_date,
                e.update_by
            FROM finance.expenses e
            LEFT JOIN employees.employee_roles er
                ON er.reference_key = e.employee_id
            LEFT JOIN clients.states s
                ON s.reference_key = e.state_id
            LEFT JOIN clients.tribes t
                ON t.reference_key = e.tribe_id
            LEFT JOIN clients.casinos c
                ON c.reference_key = e.casino_id
            {_EXPENSE_ACCOUNT_JOIN}
            WHERE e.reference_key = %s
            """,
            (key,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    if not rows:
        raise HTTPException(status_code=404, detail="expense not found")

    r = rows[0]
    payload = _row_payload(r)
    payload.update(
        {
            "state_id": _json_value(r.get("state_id")),
            "state_name": _json_value(r.get("state_name")),
            "tribe_id": _json_value(r.get("tribe_id")),
            "casino_id": _json_value(r.get("casino_id")),
            "override_receipt": bool(r.get("override_receipt")),
            "insert_date": _json_value(r.get("insert_date")),
            "update_date": _json_value(r.get("update_date")),
            "update_by": _json_value(r.get("update_by")),
        }
    )
    return payload
