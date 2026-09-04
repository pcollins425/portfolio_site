"""Parts storefront company accounts + tax exemptions (casino_next opt-in)."""

from __future__ import annotations

import os
import re
import secrets
import uuid
from datetime import date, datetime
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from app import mssql
from app.parts_customer_auth import (
    hash_password,
    mint_user_token,
    optional_parts_user,
    require_company_admin,
    require_parts_user,
    require_staff_token,
    verify_password,
)

router = APIRouter(prefix="/api/parts-catalog", tags=["parts-catalog-accounts"])

_MAX_ADMINS = 2


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


def _company_public(row: dict) -> dict:
    casino_id = row.get("casino_id")
    lease_eligible = False
    if casino_id:
        hit = _field_query(
            """
            SELECT TOP 1 1 AS ok
            FROM inventory.slot_master_migration
            WHERE casino_id = %s AND is_active = 1
            """,
            (casino_id,),
        )
        lease_eligible = bool(hit)
    return {
        "company_id": row.get("company_id"),
        "casino_id": casino_id,
        "display_name": row.get("display_name"),
        "casino_short": row.get("casino_short"),
        "shop_enabled": bool(row.get("shop_enabled")),
        "tax_exempt_status": row.get("tax_exempt_status") or "none",
        "stripe_customer_id": row.get("stripe_customer_id"),
        "lease_eligible": lease_eligible,
    }


def _user_public(row: dict) -> dict:
    return {
        "user_id": row.get("user_id"),
        "email": row.get("email"),
        "display_name": row.get("display_name"),
        "role": row.get("role"),
        "company_id": row.get("company_id"),
    }


def _load_company(company_id: str) -> dict:
    rows = _field_query(
        """
        SELECT company_id, casino_id, display_name, casino_short, shop_enabled,
               stripe_customer_id, tax_exempt_status
        FROM inventory.parts_company
        WHERE company_id = %s
        """,
        (company_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Company not found")
    return rows[0]


def _load_user(user_id: str) -> dict:
    rows = _field_query(
        """
        SELECT user_id, company_id, email, display_name, role
        FROM inventory.parts_company_user
        WHERE user_id = %s
        """,
        (user_id,),
    )
    if not rows:
        raise HTTPException(status_code=401, detail="Account not found")
    return rows[0]


def _admin_count(company_id: str) -> int:
    rows = _field_query(
        """
        SELECT COUNT(*) AS n
        FROM inventory.parts_company_user
        WHERE company_id = %s AND role = N'admin'
        """,
        (company_id,),
    )
    return int((rows[0] or {}).get("n") or 0)


def _create_user(
    *,
    company_id: str,
    email: str,
    password: str,
    display_name: str,
    role: str,
) -> dict:
    role = role.strip().lower()
    if role not in ("admin", "buyer"):
        raise HTTPException(status_code=400, detail="role must be admin or buyer")
    if role == "admin" and _admin_count(company_id) >= _MAX_ADMINS:
        raise HTTPException(status_code=409, detail=f"Company already has {_MAX_ADMINS} admins")
    email_n = _norm_email(email)
    if "@" not in email_n:
        raise HTTPException(status_code=400, detail="Valid email required")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    existing = _field_query(
        "SELECT user_id FROM inventory.parts_company_user WHERE email = %s",
        (email_n,),
    )
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    company = _load_company(company_id)
    if not company.get("shop_enabled"):
        raise HTTPException(status_code=400, detail="Company is not enabled for the shop")
    user_id = _new_id("PCU")
    _field_execute(
        """
        INSERT INTO inventory.parts_company_user
            (user_id, company_id, email, password_hash, display_name, role)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (user_id, company_id, email_n, hash_password(password), display_name.strip(), role),
    )
    return _load_user(user_id)


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)


class AddMemberIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=8, max_length=200)
    display_name: str = Field(min_length=1, max_length=200)
    role: str = Field(default="buyer", pattern="^(admin|buyer)$")


class StaffEnableCompanyIn(BaseModel):
    casino_id: str = Field(min_length=3, max_length=40)


class StaffAddUserIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=8, max_length=200)
    display_name: str = Field(min_length=1, max_length=200)
    role: str = Field(default="admin", pattern="^(admin|buyer)$")


class ExemptionReviewIn(BaseModel):
    status: str = Field(pattern="^(approved|rejected)$")
    staff_note: str | None = Field(default=None, max_length=500)
    reviewed_by: str | None = Field(default=None, max_length=120)


@router.post("/account/login")
def login(body: LoginIn):
    email = _norm_email(body.email)
    rows = _field_query(
        """
        SELECT u.user_id, u.company_id, u.email, u.password_hash, u.display_name, u.role,
               c.shop_enabled, c.display_name AS company_name, c.tax_exempt_status,
               c.casino_id, c.casino_short, c.stripe_customer_id
        FROM inventory.parts_company_user AS u
        INNER JOIN inventory.parts_company AS c ON c.company_id = u.company_id
        WHERE u.email = %s
        """,
        (email,),
    )
    if not rows or not verify_password(body.password, rows[0]["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    row = rows[0]
    if not row.get("shop_enabled"):
        raise HTTPException(status_code=403, detail="Company shop access is disabled")
    token = mint_user_token(
        user_id=row["user_id"],
        company_id=row["company_id"],
        email=row["email"],
        role=row["role"],
    )
    company_pub = _company_public(
        {
            "company_id": row["company_id"],
            "casino_id": row["casino_id"],
            "display_name": row["company_name"],
            "casino_short": row.get("casino_short"),
            "shop_enabled": True,
            "tax_exempt_status": row.get("tax_exempt_status") or "none",
            "stripe_customer_id": row.get("stripe_customer_id"),
        }
    )
    return {
        "token": token,
        "user": _user_public(row),
        "company": company_pub,
    }


@router.get("/account/me")
def me(user=Depends(require_parts_user)):
    urow = _load_user(str(user["sub"]))
    company = _load_company(urow["company_id"])
    if not company.get("shop_enabled"):
        raise HTTPException(status_code=403, detail="Company shop access is disabled")
    apps = _field_query(
        """
        SELECT TOP 5 application_id, legal_name, exemption_number, issuing_state,
               expiration_date, status, staff_note, created_at, reviewed_at
        FROM inventory.parts_tax_exemption_application
        WHERE company_id = %s
        ORDER BY created_at DESC
        """,
        (company["company_id"],),
    )
    members = []
    if urow.get("role") == "admin":
        mrows = _field_query(
            """
            SELECT user_id, email, display_name, role, created_at
            FROM inventory.parts_company_user
            WHERE company_id = %s
            ORDER BY role ASC, display_name ASC
            """,
            (company["company_id"],),
        )
        members = [
            {
                **_user_public(m),
                "created_at": _json_dt(m.get("created_at")),
            }
            for m in mrows
        ]
    return {
        "user": _user_public(urow),
        "company": _company_public(company),
        "members": members,
        "admin_slots_remaining": max(0, _MAX_ADMINS - _admin_count(company["company_id"])),
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


@router.post("/account/members")
def add_member(body: AddMemberIn, admin=Depends(require_company_admin)):
    """Company admin invites a colleague (max 2 admins)."""
    company_id = str(admin["company_id"])
    created = _create_user(
        company_id=company_id,
        email=body.email,
        password=body.password,
        display_name=body.display_name,
        role=body.role,
    )
    return {"user": _user_public(created), "company": _company_public(_load_company(company_id))}


@router.delete("/account/members/{user_id}")
def remove_member(user_id: str, admin=Depends(require_company_admin)):
    company_id = str(admin["company_id"])
    target = _load_user(user_id)
    if target["company_id"] != company_id:
        raise HTTPException(status_code=404, detail="Member not found")
    if target["user_id"] == admin["sub"]:
        raise HTTPException(status_code=400, detail="Cannot remove yourself")
    if target.get("role") == "admin" and _admin_count(company_id) <= 1:
        raise HTTPException(status_code=400, detail="Company must keep at least one admin")
    _field_execute(
        "DELETE FROM inventory.parts_company_user WHERE user_id = %s AND company_id = %s",
        (user_id, company_id),
    )
    return {"ok": True}


@router.post("/account/exemption-applications")
async def submit_exemption(
    legal_name: str = Form(...),
    exemption_number: str = Form(...),
    issuing_state: str = Form(...),
    expiration_date: str | None = Form(None),
    certificate: UploadFile | None = File(None),
    admin=Depends(require_company_admin),
):
    company_id = str(admin["company_id"])
    company = _load_company(company_id)
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
        WHERE company_id = %s AND status = N'pending'
        """,
        (company_id,),
    )
    if pending:
        raise HTTPException(status_code=409, detail="An exemption application is already pending")

    cert_path = None
    if certificate and certificate.filename:
        from pathlib import Path

        root = Path(
            (os.environ.get("PARTS_EXEMPTION_UPLOAD_ROOT") or "/tmp/parts_exemption_certs").strip()
        )
        root.mkdir(parents=True, exist_ok=True)
        safe = re.sub(r"[^A-Za-z0-9._-]+", "_", certificate.filename)[:80] or "cert.bin"
        dest = root / f"{company_id}_{secrets.token_hex(4)}_{safe}"
        data = await certificate.read()
        if len(data) > 8_000_000:
            raise HTTPException(status_code=400, detail="Certificate file too large (8MB max)")
        dest.write_bytes(data)
        cert_path = str(dest)

    app_id = _new_id("PX")
    _field_execute(
        """
        INSERT INTO inventory.parts_tax_exemption_application
            (application_id, company_id, submitted_by, legal_name, exemption_number,
             issuing_state, expiration_date, certificate_path, status)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, N'pending')
        """,
        (app_id, company_id, admin["sub"], legal, number, state, exp, cert_path),
    )
    _field_execute(
        """
        UPDATE inventory.parts_company
        SET tax_exempt_status = N'pending', updated_at = SYSUTCDATETIME()
        WHERE company_id = %s AND tax_exempt_status <> N'approved'
        """,
        (company_id,),
    )
    return {
        "application_id": app_id,
        "status": "pending",
        "message": "Submitted — company orders stay taxed until staff approves.",
        "company": _company_public(_load_company(company_id)),
    }


# ---- DGS staff ----


@router.get("/staff/casinos")
def search_casinos(q: str = Query("", max_length=80), _staff: str = Depends(require_staff_token)):
    term = (q or "").strip()
    if len(term) < 2:
        return {"casinos": []}
    like = f"%{term}%"
    rows = _field_query(
        """
        SELECT TOP 30
            c.reference_key AS casino_id,
            c.casino_short,
            c.casino_name,
            c.agreement_type,
            c.city,
            CASE WHEN pc.company_id IS NULL THEN 0 ELSE 1 END AS already_enabled,
            pc.company_id,
            pc.shop_enabled
        FROM clients.casinos_next AS c
        LEFT JOIN inventory.parts_company AS pc ON pc.casino_id = c.reference_key
        WHERE c.reference_key LIKE %s
           OR c.casino_short LIKE %s
           OR c.casino_name LIKE %s
        ORDER BY c.casino_short
        """,
        (like, like, like),
    )
    return {
        "casinos": [
            {
                "casino_id": r.get("casino_id"),
                "casino_short": r.get("casino_short"),
                "casino_name": r.get("casino_name"),
                "agreement_type": r.get("agreement_type"),
                "city": r.get("city"),
                "already_enabled": bool(r.get("already_enabled")),
                "company_id": r.get("company_id"),
                "shop_enabled": bool(r.get("shop_enabled")) if r.get("company_id") else False,
            }
            for r in rows
        ]
    }


@router.get("/staff/companies")
def list_companies(enabled_only: bool = True, _staff: str = Depends(require_staff_token)):
    if enabled_only:
        rows = _field_query(
            """
            SELECT company_id, casino_id, display_name, casino_short, shop_enabled,
                   tax_exempt_status, stripe_customer_id, created_at
            FROM inventory.parts_company
            WHERE shop_enabled = 1
            ORDER BY display_name
            """
        )
    else:
        rows = _field_query(
            """
            SELECT company_id, casino_id, display_name, casino_short, shop_enabled,
                   tax_exempt_status, stripe_customer_id, created_at
            FROM inventory.parts_company
            ORDER BY display_name
            """
        )
    out = []
    for r in rows:
        admins = _field_query(
            """
            SELECT user_id, email, display_name, role
            FROM inventory.parts_company_user
            WHERE company_id = %s
            ORDER BY role ASC, display_name ASC
            """,
            (r["company_id"],),
        )
        out.append(
            {
                **_company_public(r),
                "created_at": _json_dt(r.get("created_at")),
                "users": [_user_public(a) for a in admins],
                "admin_count": sum(1 for a in admins if a.get("role") == "admin"),
            }
        )
    return {"companies": out}


@router.post("/staff/companies/enable")
def enable_company(body: StaffEnableCompanyIn, _staff: str = Depends(require_staff_token)):
    casino_id = body.casino_id.strip().upper()
    rows = _field_query(
        """
        SELECT reference_key, casino_short, casino_name
        FROM clients.casinos_next
        WHERE reference_key = %s
        """,
        (casino_id,),
    )
    if not rows:
        raise HTTPException(status_code=404, detail=f"casino not found in casinos_next: {casino_id}")
    cas = rows[0]
    existing = _field_query(
        "SELECT company_id FROM inventory.parts_company WHERE casino_id = %s",
        (casino_id,),
    )
    if existing:
        _field_execute(
            """
            UPDATE inventory.parts_company
            SET shop_enabled = 1,
                display_name = %s,
                casino_short = %s,
                updated_at = SYSUTCDATETIME()
            WHERE casino_id = %s
            """,
            (cas.get("casino_name") or cas.get("casino_short"), cas.get("casino_short"), casino_id),
        )
        return {"company": _company_public(_load_company(existing[0]["company_id"]))}
    company_id = _new_id("PCO")
    _field_execute(
        """
        INSERT INTO inventory.parts_company
            (company_id, casino_id, display_name, casino_short, shop_enabled)
        VALUES (%s, %s, %s, %s, 1)
        """,
        (
            company_id,
            casino_id,
            cas.get("casino_name") or cas.get("casino_short"),
            cas.get("casino_short"),
        ),
    )
    return {"company": _company_public(_load_company(company_id))}


@router.post("/staff/companies/{company_id}/users")
def staff_add_user(
    company_id: str,
    body: StaffAddUserIn,
    _staff: str = Depends(require_staff_token),
):
    created = _create_user(
        company_id=company_id,
        email=body.email,
        password=body.password,
        display_name=body.display_name,
        role=body.role,
    )
    return {"user": _user_public(created), "company": _company_public(_load_company(company_id))}


@router.get("/staff/exemption-applications")
def list_exemption_apps(status: str = "pending", _staff: str = Depends(require_staff_token)):
    st = (status or "pending").strip().lower()
    if st not in ("pending", "approved", "rejected", "all"):
        raise HTTPException(status_code=400, detail="status must be pending|approved|rejected|all")
    if st == "all":
        rows = _field_query(
            """
            SELECT a.application_id, a.company_id, a.legal_name, a.exemption_number,
                   a.issuing_state, a.expiration_date, a.certificate_path, a.status,
                   a.staff_note, a.created_at, a.reviewed_at, a.reviewed_by,
                   c.display_name, c.casino_short, c.casino_id, c.tax_exempt_status
            FROM inventory.parts_tax_exemption_application AS a
            INNER JOIN inventory.parts_company AS c ON c.company_id = a.company_id
            ORDER BY a.created_at DESC
            """
        )
    else:
        rows = _field_query(
            """
            SELECT a.application_id, a.company_id, a.legal_name, a.exemption_number,
                   a.issuing_state, a.expiration_date, a.certificate_path, a.status,
                   a.staff_note, a.created_at, a.reviewed_at, a.reviewed_by,
                   c.display_name, c.casino_short, c.casino_id, c.tax_exempt_status
            FROM inventory.parts_tax_exemption_application AS a
            INNER JOIN inventory.parts_company AS c ON c.company_id = a.company_id
            WHERE a.status = %s
            ORDER BY a.created_at DESC
            """,
            (st,),
        )
    return {
        "applications": [
            {
                "application_id": r.get("application_id"),
                "company_id": r.get("company_id"),
                "casino_id": r.get("casino_id"),
                "display_name": r.get("display_name"),
                "casino_short": r.get("casino_short"),
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


def _ensure_stripe_customer(company: dict) -> str:
    import stripe

    sk = (os.environ.get("STRIPE_SECRET_KEY") or "").strip()
    if not sk:
        raise HTTPException(status_code=503, detail="STRIPE_SECRET_KEY not configured")
    stripe.api_key = sk
    existing = (company.get("stripe_customer_id") or "").strip()
    if existing:
        return existing
    cust = stripe.Customer.create(
        name=company.get("display_name") or company.get("casino_short"),
        metadata={
            "parts_company_id": company["company_id"],
            "casino_id": company.get("casino_id") or "",
            "source": "parts_catalog",
        },
    )
    _field_execute(
        """
        UPDATE inventory.parts_company
        SET stripe_customer_id = %s, updated_at = SYSUTCDATETIME()
        WHERE company_id = %s
        """,
        (cust.id, company["company_id"]),
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
        SELECT a.application_id, a.company_id, a.status,
               c.display_name, c.casino_short, c.casino_id, c.stripe_customer_id, c.tax_exempt_status
        FROM inventory.parts_tax_exemption_application AS a
        INNER JOIN inventory.parts_company AS c ON c.company_id = a.company_id
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
            UPDATE inventory.parts_company
            SET tax_exempt_status = N'approved',
                stripe_customer_id = %s,
                updated_at = SYSUTCDATETIME()
            WHERE company_id = %s
            """,
            (stripe_id, app["company_id"]),
        )
    else:
        _field_execute(
            """
            UPDATE inventory.parts_company
            SET tax_exempt_status = N'rejected', updated_at = SYSUTCDATETIME()
            WHERE company_id = %s AND tax_exempt_status = N'pending'
            """,
            (app["company_id"],),
        )

    return {
        "application_id": application_id,
        "status": new_status,
        "company": _company_public(_load_company(app["company_id"])),
    }


__all__ = ["router", "optional_parts_user", "require_parts_user"]
