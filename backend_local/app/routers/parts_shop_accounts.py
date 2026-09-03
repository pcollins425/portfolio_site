"""Parts storefront accounts + tax-exemption applications (A+B hybrid)."""

from __future__ import annotations

import os
import re
import secrets
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app import mssql
from app.parts_customer_auth import (
    hash_password,
    mint_customer_token,
    optional_parts_customer,
    require_parts_customer,
    require_staff_token,
    verify_password,
)

router = APIRouter(prefix="/api/parts-catalog", tags=["parts-catalog-accounts"])


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


def _field_execute(sql: str, params=None) -> int:
    return mssql.execute(
        sql,
        params=params,
        database=_catalog(),
        profile="field",
        load_env=False,
    )


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12].upper()}"


def _norm_email(email: str) -> str:
    return email.strip().lower()


def _json_dt(v):
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    return v


def _customer_public(row: dict) -> dict:
    return {
        "customer_id": row.get("customer_id"),
        "email": row.get("email"),
        "display_name": row.get("display_name"),
        "company": row.get("company"),
        "tax_exempt_status": row.get("tax_exempt_status") or "none",
        "stripe_customer_id": row.get("stripe_customer_id"),
    }


def _load_customer(customer_id: str) -> dict:
    rows = _field_query(
        """
        SELECT customer_id, email, display_name, company, stripe_customer_id, tax_exempt_status
        FROM inventory.parts_customer
        WHERE customer_id = %s
        """,
        (customer_id,),
    )
    if not rows:
        raise HTTPException(status_code=401, detail="Account not found")
    return rows[0]


class RegisterIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=8, max_length=200)
    display_name: str = Field(min_length=1, max_length=200)
    company: str | None = Field(default=None, max_length=200)


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)


class ExemptionReviewIn(BaseModel):
    status: str = Field(pattern="^(approved|rejected)$")
    staff_note: str | None = Field(default=None, max_length=500)
    reviewed_by: str | None = Field(default=None, max_length=120)


@router.post("/account/register")
def register(body: RegisterIn):
    email = _norm_email(body.email)
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Valid email required")
    existing = _field_query(
        "SELECT customer_id FROM inventory.parts_customer WHERE email = %s",
        (email,),
    )
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    customer_id = _new_id("PC")
    _field_execute(
        """
        INSERT INTO inventory.parts_customer
            (customer_id, email, password_hash, display_name, company, tax_exempt_status)
        VALUES (%s, %s, %s, %s, %s, N'none')
        """,
        (
            customer_id,
            email,
            hash_password(body.password),
            body.display_name.strip(),
            (body.company or "").strip() or None,
        ),
    )
    row = _load_customer(customer_id)
    token = mint_customer_token(customer_id=customer_id, email=email)
    return {"token": token, "customer": _customer_public(row)}


@router.post("/account/login")
def login(body: LoginIn):
    email = _norm_email(body.email)
    rows = _field_query(
        """
        SELECT customer_id, email, password_hash, display_name, company,
               stripe_customer_id, tax_exempt_status
        FROM inventory.parts_customer
        WHERE email = %s
        """,
        (email,),
    )
    if not rows or not verify_password(body.password, rows[0]["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    row = rows[0]
    token = mint_customer_token(customer_id=row["customer_id"], email=row["email"])
    return {"token": token, "customer": _customer_public(row)}


@router.get("/account/me")
def me(user=Depends(require_parts_customer)):
    row = _load_customer(str(user["sub"]))
    apps = _field_query(
        """
        SELECT TOP 5 application_id, legal_name, exemption_number, issuing_state,
               expiration_date, status, staff_note, created_at, reviewed_at
        FROM inventory.parts_tax_exemption_application
        WHERE customer_id = %s
        ORDER BY created_at DESC
        """,
        (row["customer_id"],),
    )
    return {
        "customer": _customer_public(row),
        "applications": [
            {
                "application_id": a.get("application_id"),
                "legal_name": a.get("legal_name"),
                "exemption_number": a.get("exemption_number"),
                "issuing_state": a.get("issuing_state"),
                "expiration_date": _json_dt(a.get("expiration_date")),
                "status": a.get("status"),
                "staff_note": a.get("staff_note"),
                "created_at": _json_dt(a.get("created_at")),
                "reviewed_at": _json_dt(a.get("reviewed_at")),
            }
            for a in apps
        ],
    }


@router.post("/account/exemption-applications")
async def submit_exemption(
    legal_name: str = Form(...),
    exemption_number: str = Form(...),
    issuing_state: str = Form(...),
    expiration_date: str | None = Form(None),
    certificate: UploadFile | None = File(None),
    user=Depends(require_parts_customer),
):
    customer_id = str(user["sub"])
    row = _load_customer(customer_id)
    legal = legal_name.strip()
    number = exemption_number.strip()
    state = issuing_state.strip().upper()[:10]
    if not legal or not number or not state:
        raise HTTPException(status_code=400, detail="legal_name, exemption_number, issuing_state required")

    exp: date | None = None
    if expiration_date and expiration_date.strip():
        try:
            exp = date.fromisoformat(expiration_date.strip()[:10])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="expiration_date must be YYYY-MM-DD") from exc

    pending = _field_query(
        """
        SELECT application_id FROM inventory.parts_tax_exemption_application
        WHERE customer_id = %s AND status = N'pending'
        """,
        (customer_id,),
    )
    if pending:
        raise HTTPException(status_code=409, detail="An exemption application is already pending")

    cert_path = None
    if certificate and certificate.filename:
        root = Path(
            (os.environ.get("PARTS_EXEMPTION_UPLOAD_ROOT") or "/tmp/parts_exemption_certs").strip()
        )
        root.mkdir(parents=True, exist_ok=True)
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", certificate.filename)[:80] or "cert.bin"
        dest = root / f"{customer_id}_{secrets.token_hex(4)}_{safe}"
        data = await certificate.read()
        if len(data) > 8_000_000:
            raise HTTPException(status_code=400, detail="Certificate file too large (8MB max)")
        dest.write_bytes(data)
        cert_path = str(dest)

    app_id = _new_id("PX")
    _field_execute(
        """
        INSERT INTO inventory.parts_tax_exemption_application
            (application_id, customer_id, legal_name, exemption_number, issuing_state,
             expiration_date, certificate_path, status)
        VALUES (%s, %s, %s, %s, %s, %s, %s, N'pending')
        """,
        (app_id, customer_id, legal, number, state, exp, cert_path),
    )
    _field_execute(
        """
        UPDATE inventory.parts_customer
        SET tax_exempt_status = N'pending', updated_at = SYSUTCDATETIME()
        WHERE customer_id = %s AND tax_exempt_status <> N'approved'
        """,
        (customer_id,),
    )
    return {
        "application_id": app_id,
        "status": "pending",
        "message": "Submitted — this and future orders stay taxed until staff approves.",
        "customer": _customer_public(_load_customer(customer_id)),
    }


@router.get("/staff/exemption-applications")
def list_exemption_apps(status: str = "pending", _staff: str = Depends(require_staff_token)):
    st = (status or "pending").strip().lower()
    if st not in ("pending", "approved", "rejected", "all"):
        raise HTTPException(status_code=400, detail="status must be pending|approved|rejected|all")
    if st == "all":
        rows = _field_query(
            """
            SELECT a.application_id, a.customer_id, a.legal_name, a.exemption_number,
                   a.issuing_state, a.expiration_date, a.certificate_path, a.status,
                   a.staff_note, a.created_at, a.reviewed_at, a.reviewed_by,
                   c.email, c.display_name, c.company, c.tax_exempt_status
            FROM inventory.parts_tax_exemption_application AS a
            INNER JOIN inventory.parts_customer AS c ON c.customer_id = a.customer_id
            ORDER BY a.created_at DESC
            """
        )
    else:
        rows = _field_query(
            """
            SELECT a.application_id, a.customer_id, a.legal_name, a.exemption_number,
                   a.issuing_state, a.expiration_date, a.certificate_path, a.status,
                   a.staff_note, a.created_at, a.reviewed_at, a.reviewed_by,
                   c.email, c.display_name, c.company, c.tax_exempt_status
            FROM inventory.parts_tax_exemption_application AS a
            INNER JOIN inventory.parts_customer AS c ON c.customer_id = a.customer_id
            WHERE a.status = %s
            ORDER BY a.created_at DESC
            """,
            (st,),
        )
    return {
        "applications": [
            {
                "application_id": r.get("application_id"),
                "customer_id": r.get("customer_id"),
                "email": r.get("email"),
                "display_name": r.get("display_name"),
                "company": r.get("company"),
                "legal_name": r.get("legal_name"),
                "exemption_number": r.get("exemption_number"),
                "issuing_state": r.get("issuing_state"),
                "expiration_date": _json_dt(r.get("expiration_date")),
                "certificate_path": r.get("certificate_path"),
                "status": r.get("status"),
                "staff_note": r.get("staff_note"),
                "created_at": _json_dt(r.get("created_at")),
                "reviewed_at": _json_dt(r.get("reviewed_at")),
                "reviewed_by": r.get("reviewed_by"),
                "tax_exempt_status": r.get("tax_exempt_status"),
            }
            for r in rows
        ]
    }


def _ensure_stripe_customer(row: dict) -> str:
    import stripe

    sk = (os.environ.get("STRIPE_SECRET_KEY") or "").strip()
    if not sk:
        raise HTTPException(status_code=503, detail="STRIPE_SECRET_KEY not configured")
    stripe.api_key = sk
    existing = (row.get("stripe_customer_id") or "").strip()
    if existing:
        return existing
    cust = stripe.Customer.create(
        email=row["email"],
        name=row.get("display_name") or row["email"],
        metadata={"parts_customer_id": row["customer_id"], "source": "parts_catalog"},
    )
    _field_execute(
        """
        UPDATE inventory.parts_customer
        SET stripe_customer_id = %s, updated_at = SYSUTCDATETIME()
        WHERE customer_id = %s
        """,
        (cust.id, row["customer_id"]),
    )
    return cust.id


@router.post("/staff/exemption-applications/{application_id}/review")
def review_exemption(
    application_id: str,
    body: ExemptionReviewIn,
    _staff: str = Depends(require_staff_token),
):
    import stripe

    rows = _field_query(
        """
        SELECT a.application_id, a.customer_id, a.status,
               c.email, c.display_name, c.stripe_customer_id, c.tax_exempt_status
        FROM inventory.parts_tax_exemption_application AS a
        INNER JOIN inventory.parts_customer AS c ON c.customer_id = a.customer_id
        WHERE a.application_id = %s
        """,
        (application_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="application not found")
    app = rows[0]
    if app.get("status") != "pending":
        raise HTTPException(status_code=409, detail=f"Already {app.get('status')}")

    new_status = body.status
    note = (body.staff_note or "").strip() or None
    reviewed_by = (body.reviewed_by or "staff").strip()[:120]

    _field_execute(
        """
        UPDATE inventory.parts_tax_exemption_application
        SET status = %s, staff_note = %s, reviewed_at = SYSUTCDATETIME(), reviewed_by = %s
        WHERE application_id = %s
        """,
        (new_status, note, reviewed_by, application_id),
    )

    if new_status == "approved":
        sk = (os.environ.get("STRIPE_SECRET_KEY") or "").strip()
        if not sk:
            raise HTTPException(status_code=503, detail="STRIPE_SECRET_KEY not configured")
        stripe_id = _ensure_stripe_customer(app)
        stripe.api_key = sk
        stripe.Customer.modify(stripe_id, tax_exempt="exempt")
        _field_execute(
            """
            UPDATE inventory.parts_customer
            SET tax_exempt_status = N'approved',
                stripe_customer_id = %s,
                updated_at = SYSUTCDATETIME()
            WHERE customer_id = %s
            """,
            (stripe_id, app["customer_id"]),
        )
    else:
        _field_execute(
            """
            UPDATE inventory.parts_customer
            SET tax_exempt_status = N'rejected', updated_at = SYSUTCDATETIME()
            WHERE customer_id = %s AND tax_exempt_status = N'pending'
            """,
            (app["customer_id"],),
        )

    return {
        "application_id": application_id,
        "status": new_status,
        "customer": _customer_public(_load_customer(app["customer_id"])),
    }


# Re-export optional dependency for checkout tax path
__all__ = ["router", "optional_parts_customer", "require_parts_customer"]
