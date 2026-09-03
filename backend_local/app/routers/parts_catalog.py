"""Parts shopping catalog — inventory.inventory browse (isolated from /api/parts-inventory)."""

from __future__ import annotations

import math
import mimetypes
import os
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.auth_deps import require_demo_user
from app.parts_customer_auth import optional_parts_customer
from app import mssql

router = APIRouter(prefix="/api/parts-catalog", tags=["parts-catalog"])

_INVENTORY_FROM = """
    FROM inventory.inventory AS i
    LEFT JOIN inventory.software AS sw ON sw.item = i.item
"""
_EXCLUDE_SW = " AND sw.item IS NULL"


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


def _require_employee(user: dict[str, Any] | None) -> str:
    """Server cart is signed-in only. Guests use browser localStorage."""
    emp = str((user or {}).get("employee_id") or "").strip()
    if not emp:
        raise HTTPException(status_code=401, detail="Sign in required for synced cart")
    return emp


class CartLineIn(BaseModel):
    item: str = Field(min_length=1, max_length=80)
    qty: int = Field(default=1, ge=1, le=9999)
    note: str | None = Field(default=None, max_length=200)


class CartPutIn(BaseModel):
    lines: list[CartLineIn] = Field(default_factory=list)
    merge: bool = False


def _cart_lines_for(employee_id: str) -> list[dict]:
    rows = _field_query(
        """
        SELECT
            c.item, c.qty, c.note, c.updated_at,
            i.descrip, i.mfr, i.onhand, i.photo_path
        FROM inventory.parts_cart_line AS c
        LEFT JOIN inventory.inventory AS i ON i.item = c.item
        WHERE c.employee_id = %s
        ORDER BY c.updated_at DESC, c.item ASC
        """,
        (employee_id,),
    )
    out = []
    for r in rows:
        out.append(
            {
                "item": _json_value(r.get("item")),
                "qty": int(r.get("qty") or 0),
                "note": _json_value(r.get("note")),
                "updated_at": _json_value(r.get("updated_at")),
                "descrip": _json_value(r.get("descrip")),
                "mfr": _json_value(r.get("mfr")),
                "onhand": _json_value(r.get("onhand")),
                "has_photo": bool(_json_value(r.get("photo_path"))),
            }
        )
    return out


def _upsert_line(employee_id: str, item: str, qty: int, note: str | None, *, add_qty: bool) -> None:
    existing = _field_query(
        """
        SELECT qty, note
        FROM inventory.parts_cart_line
        WHERE employee_id = %s AND item = %s
        """,
        (employee_id, item),
    )
    if existing:
        new_qty = int(existing[0]["qty"] or 0) + qty if add_qty else qty
        if new_qty < 1:
            _field_execute(
                "DELETE FROM inventory.parts_cart_line WHERE employee_id = %s AND item = %s",
                (employee_id, item),
            )
            return
        if new_qty > 9999:
            new_qty = 9999
        keep_note = note if note is not None else _json_value(existing[0].get("note"))
        _field_execute(
            """
            UPDATE inventory.parts_cart_line
            SET qty = %s, note = %s, updated_at = SYSUTCDATETIME()
            WHERE employee_id = %s AND item = %s
            """,
            (new_qty, keep_note, employee_id, item),
        )
        return

    inv = _field_query("SELECT item FROM inventory.inventory WHERE item = %s", (item,))
    if not inv:
        raise HTTPException(status_code=404, detail=f"part not found: {item!r}")
    _field_execute(
        """
        INSERT INTO inventory.parts_cart_line (employee_id, item, qty, note)
        VALUES (%s, %s, %s, %s)
        """,
        (employee_id, item, qty, note),
    )


def _json_value(v):
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    return str(v).strip() if isinstance(v, str) else v


def _photos_root() -> Path | None:
    for key in ("PARTS_PHOTOS_ROOT",):
        val = (os.environ.get(key) or "").strip()
        if val:
            p = Path(val)
            if p.is_dir():
                return p.resolve()
    for candidate in (
        r"Z:\parts_photos",
        "/media/parts-photos",
        "/tmp/parts_photos",
        "/mnt/z/parts_photos",
    ):
        p = Path(candidate)
        if p.is_dir():
            return p.resolve()
    return None


def _filename_from_stored(rel: str | None) -> str | None:
    if not rel:
        return None
    name = str(rel).replace("\\", "/").split("/")[-1].strip()
    return name or None


def _card(r: dict) -> dict:
    photo = _json_value(r.get("photo_path"))
    photo2 = _json_value(r.get("photo_path_2"))
    cost = r.get("cost")
    try:
        cost_f = float(cost) if cost is not None else None
    except (TypeError, ValueError):
        cost_f = None
    # Dev showcase markup — replace with real sell_price later
    list_price = round(cost_f * 1.30, 2) if cost_f is not None and cost_f >= 0 else None
    onhand = _json_value(r.get("onhand"))
    try:
        onhand_n = float(onhand) if onhand is not None else 0.0
    except (TypeError, ValueError):
        onhand_n = 0.0
    return {
        "item": _json_value(r.get("item")),
        "descrip": _json_value(r.get("descrip")),
        "mfr": _json_value(r.get("mfr")),
        "item_family": _json_value(r.get("item_family")),
        "item_subcategory": _json_value(r.get("item_subcategory")),
        "emaint_category": _json_value(r.get("emaint_category")),
        "cabinet": _json_value(r.get("cabinet")),
        "cabinet_2": _json_value(r.get("cabinet_2")),
        "mfrpartno": _json_value(r.get("mfrpartno")),
        "onhand": onhand,
        "in_stock": onhand_n > 0,
        "list_price": list_price,
        "currency": "USD",
        "has_photo": bool(photo),
        "has_photo_2": bool(photo2),
    }


def _aisle_rows(sql: str) -> list[dict]:
    rows = _field_query(sql)
    out = []
    for r in rows:
        val = _json_value(r.get("value"))
        if not val:
            continue
        out.append({"value": val, "label": val, "count": int(r.get("n") or 0)})
    return out


@router.get("/checkout-config")
def checkout_config():
    """Public Stripe bootstrap — publishable key only (never secret)."""
    pk = (os.environ.get("STRIPE_PUBLISHABLE_KEY") or "").strip()
    if not pk:
        raise HTTPException(status_code=503, detail="STRIPE_PUBLISHABLE_KEY not configured")
    if not pk.startswith(("pk_test_", "pk_live_")):
        raise HTTPException(status_code=503, detail="STRIPE_PUBLISHABLE_KEY looks invalid")
    return {
        "publishableKey": pk,
        "mode": "live" if pk.startswith("pk_live_") else "test",
    }


class CheckoutLinePayIn(BaseModel):
    item: str = Field(min_length=1, max_length=80)
    qty: int = Field(default=1, ge=1, le=9999)


class CreatePaymentIntentIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    phone: str | None = Field(default=None, max_length=40)
    name: str = Field(min_length=1, max_length=200)
    company: str | None = Field(default=None, max_length=200)
    line1: str = Field(min_length=1, max_length=200)
    line2: str | None = Field(default=None, max_length=200)
    city: str = Field(min_length=1, max_length=100)
    state: str = Field(min_length=1, max_length=40)
    postal: str = Field(min_length=1, max_length=20)
    country: str = Field(default="US", min_length=2, max_length=2)
    lines: list[CheckoutLinePayIn] = Field(min_length=1, max_length=100)


class QuoteTaxIn(CreatePaymentIntentIn):
    pass


def _stripe_secret() -> str:
    sk = (os.environ.get("STRIPE_SECRET_KEY") or "").strip()
    if not sk:
        raise HTTPException(status_code=503, detail="STRIPE_SECRET_KEY not configured")
    if not sk.startswith(("sk_test_", "sk_live_")):
        raise HTTPException(status_code=503, detail="STRIPE_SECRET_KEY looks invalid")
    return sk


def _tax_code() -> str:
    return (os.environ.get("STRIPE_TAX_CODE") or "txcd_99999999").strip() or "txcd_99999999"


def _unit_list_price(cost) -> float | None:
    try:
        cost_f = float(cost) if cost is not None else None
    except (TypeError, ValueError):
        return None
    if cost_f is None or cost_f < 0:
        return None
    return round(cost_f * 1.30, 2)


def _price_lines(lines: list[CheckoutLinePayIn]) -> tuple[list[dict], Decimal]:
    priced: list[dict] = []
    subtotal = Decimal("0.00")
    for line in lines:
        item = line.item.strip()
        rows = _field_query(
            f"""
            SELECT i.item, i.descrip, i.cost
            {_INVENTORY_FROM}
            WHERE i.item = %s {_EXCLUDE_SW}
            """,
            (item,),
        )
        if not rows:
            raise HTTPException(status_code=404, detail=f"part not found: {item!r}")
        unit = _unit_list_price(rows[0].get("cost"))
        if unit is None:
            raise HTTPException(
                status_code=400,
                detail=f"No list price for {item!r} — remove it or contact us",
            )
        qty = int(line.qty)
        line_total = (Decimal(str(unit)) * qty).quantize(Decimal("0.01"))
        subtotal += line_total
        priced.append(
            {
                "item": _json_value(rows[0].get("item")),
                "descrip": _json_value(rows[0].get("descrip")),
                "qty": qty,
                "unit_price": unit,
                "line_total": float(line_total),
                "amount_cents": int((line_total * 100).quantize(Decimal("1"))),
            }
        )
    return priced, subtotal


def _load_parts_customer(customer_id: str) -> dict | None:
    rows = _field_query(
        """
        SELECT customer_id, email, display_name, company, stripe_customer_id, tax_exempt_status
        FROM inventory.parts_customer
        WHERE customer_id = %s
        """,
        (customer_id,),
    )
    return rows[0] if rows else None


def _tax_quote_for(
    *,
    priced: list[dict],
    subtotal: Decimal,
    ship: dict[str, str],
    parts_customer: dict | None,
) -> dict:
    import stripe

    stripe.api_key = _stripe_secret()
    tax_code = _tax_code()
    line_items = []
    for i, p in enumerate(priced):
        line_items.append(
            {
                "amount": p["amount_cents"],
                "quantity": 1,
                "reference": f"{p['item']}-{i}",
                "tax_code": tax_code,
                "tax_behavior": "exclusive",
            }
        )

    exempt = bool(parts_customer and (parts_customer.get("tax_exempt_status") or "") == "approved")
    stripe_customer_id = None
    calc_kwargs: dict[str, Any] = {
        "currency": "usd",
        "line_items": line_items,
    }

    if exempt:
        stripe_customer_id = (parts_customer.get("stripe_customer_id") or "").strip() or None
        if not stripe_customer_id:
            cust = stripe.Customer.create(
                email=parts_customer.get("email"),
                name=parts_customer.get("display_name") or parts_customer.get("email"),
                tax_exempt="exempt",
                address={
                    "line1": ship["line1"],
                    "line2": ship.get("line2") or None,
                    "city": ship["city"],
                    "state": ship["state"],
                    "postal_code": ship["postal"],
                    "country": ship["country"],
                },
                shipping={
                    "name": parts_customer.get("display_name") or parts_customer.get("email"),
                    "address": {
                        "line1": ship["line1"],
                        "line2": ship.get("line2") or None,
                        "city": ship["city"],
                        "state": ship["state"],
                        "postal_code": ship["postal"],
                        "country": ship["country"],
                    },
                },
                metadata={
                    "parts_customer_id": parts_customer.get("customer_id"),
                    "source": "parts_catalog",
                },
            )
            stripe_customer_id = cust.id
            _field_execute(
                """
                UPDATE inventory.parts_customer
                SET stripe_customer_id = %s, updated_at = SYSUTCDATETIME()
                WHERE customer_id = %s
                """,
                (stripe_customer_id, parts_customer["customer_id"]),
            )
        else:
            stripe.Customer.modify(
                stripe_customer_id,
                tax_exempt="exempt",
                address={
                    "line1": ship["line1"],
                    "line2": ship.get("line2") or None,
                    "city": ship["city"],
                    "state": ship["state"],
                    "postal_code": ship["postal"],
                    "country": ship["country"],
                },
                shipping={
                    "name": parts_customer.get("display_name") or parts_customer.get("email"),
                    "address": {
                        "line1": ship["line1"],
                        "line2": ship.get("line2") or None,
                        "city": ship["city"],
                        "state": ship["state"],
                        "postal_code": ship["postal"],
                        "country": ship["country"],
                    },
                },
            )
        # Stripe allows customer OR customer_details, not both.
        calc_kwargs["customer"] = stripe_customer_id
    else:
        calc_kwargs["customer_details"] = {
            "address": {
                "line1": ship["line1"],
                "line2": ship.get("line2") or None,
                "city": ship["city"],
                "state": ship["state"],
                "postal_code": ship["postal"],
                "country": ship["country"],
            },
            "address_source": "shipping",
        }

    try:
        calc = stripe.tax.Calculation.create(**calc_kwargs)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"Stripe Tax error: {exc}") from exc

    tax_cents = int(calc.tax_amount_exclusive or 0)
    # amount_total includes tax + shipping; our shipping is 0
    total_cents = int(calc.amount_total or (int((subtotal * 100).quantize(Decimal("1"))) + tax_cents))
    reason = None
    try:
        if calc.tax_breakdown:
            br0 = calc.tax_breakdown[0]
            reason = br0.get("taxability_reason") if isinstance(br0, dict) else getattr(br0, "taxability_reason", None)
    except Exception:
        reason = None

    status = (parts_customer or {}).get("tax_exempt_status") or "none"
    message = None
    if status == "pending":
        message = "Exemption under review — this order is taxed."
    elif status == "approved" and tax_cents == 0:
        message = "Tax exempt account — $0 tax on this order."
    elif not parts_customer:
        message = "Guest checkout is taxed. Create an account to apply for tax exemption."

    return {
        "calculationId": calc.id,
        "subtotal": float(subtotal),
        "tax": float(Decimal(tax_cents) / Decimal(100)),
        "total": float(Decimal(total_cents) / Decimal(100)),
        "subtotal_cents": int((subtotal * 100).quantize(Decimal("1"))),
        "tax_cents": tax_cents,
        "total_cents": total_cents,
        "currency": "usd",
        "taxabilityReason": reason,
        "taxExemptStatus": status if parts_customer else "guest",
        "appliedExemption": exempt and tax_cents == 0,
        "stripeCustomerId": stripe_customer_id,
        "message": message,
        "lines": [
            {
                "item": p["item"],
                "descrip": p["descrip"],
                "qty": p["qty"],
                "unit_price": p["unit_price"],
                "line_total": p["line_total"],
            }
            for p in priced
        ],
    }


def _ship_dict(body: CreatePaymentIntentIn) -> dict[str, str]:
    return {
        "line1": body.line1.strip(),
        "line2": (body.line2 or "").strip(),
        "city": body.city.strip(),
        "state": body.state.strip(),
        "postal": body.postal.strip(),
        "country": (body.country or "US").strip().upper()[:2],
    }


@router.post("/checkout/quote-tax")
def quote_tax(
    body: QuoteTaxIn,
    user=Depends(optional_parts_customer),
):
    """Stripe Tax quote from ship-to. Guests/pending always taxed; approved accounts may be $0."""
    email = body.email.strip()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Valid email required")
    priced, subtotal = _price_lines(body.lines)
    parts_customer = None
    if user:
        parts_customer = _load_parts_customer(str(user["sub"]))
    quote = _tax_quote_for(
        priced=priced,
        subtotal=subtotal,
        ship=_ship_dict(body),
        parts_customer=parts_customer,
    )
    return quote


@router.post("/checkout/create-payment-intent")
def create_payment_intent(
    body: CreatePaymentIntentIn,
    user=Depends(optional_parts_customer),
):
    """Price cart + tax server-side and create a Stripe PaymentIntent."""
    import stripe

    email = body.email.strip()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Valid email required")

    priced, subtotal = _price_lines(body.lines)
    parts_customer = _load_parts_customer(str(user["sub"])) if user else None
    quote = _tax_quote_for(
        priced=priced,
        subtotal=subtotal,
        ship=_ship_dict(body),
        parts_customer=parts_customer,
    )
    amount_cents = int(quote["total_cents"])
    if amount_cents < 50:
        raise HTTPException(status_code=400, detail="Order total must be at least $0.50")

    stripe.api_key = _stripe_secret()
    mode = "live" if stripe.api_key.startswith("sk_live_") else "test"
    items_meta = ", ".join(f"{p['item']}x{p['qty']}" for p in priced)[:450]
    pi_kwargs: dict[str, Any] = {
        "amount": amount_cents,
        "currency": "usd",
        "automatic_payment_methods": {"enabled": True},
        "receipt_email": email,
        "description": f"DGS Parts order ({len(priced)} line(s))",
        "metadata": {
            "source": "parts_catalog",
            "customer_name": body.name.strip()[:200],
            "company": (body.company or "").strip()[:200],
            "phone": (body.phone or "").strip()[:40],
            "ship_city": body.city.strip()[:100],
            "ship_state": body.state.strip()[:40],
            "ship_postal": body.postal.strip()[:20],
            "ship_country": body.country.strip().upper()[:2],
            "items": items_meta,
            "tax_calculation": quote.get("calculationId") or "",
            "tax_cents": str(quote.get("tax_cents") or 0),
            "tax_exempt_status": str(quote.get("taxExemptStatus") or ""),
        },
        "shipping": {
            "name": body.name.strip(),
            "phone": (body.phone or "").strip() or None,
            "address": {
                "line1": body.line1.strip(),
                "line2": (body.line2 or "").strip() or None,
                "city": body.city.strip(),
                "state": body.state.strip(),
                "postal_code": body.postal.strip(),
                "country": body.country.strip().upper(),
            },
        },
    }
    if quote.get("stripeCustomerId"):
        pi_kwargs["customer"] = quote["stripeCustomerId"]

    try:
        intent = stripe.PaymentIntent.create(**pi_kwargs)
    except Exception as exc:  # noqa: BLE001 — surface Stripe message
        raise HTTPException(status_code=502, detail=f"Stripe error: {exc}") from exc

    return {
        "clientSecret": intent.client_secret,
        "paymentIntentId": intent.id,
        "amount": amount_cents,
        "currency": "usd",
        "subtotal": quote["subtotal"],
        "tax": quote["tax"],
        "total": quote["total"],
        "calculationId": quote.get("calculationId"),
        "taxabilityReason": quote.get("taxabilityReason"),
        "taxExemptStatus": quote.get("taxExemptStatus"),
        "appliedExemption": quote.get("appliedExemption"),
        "message": quote.get("message"),
        "lines": quote["lines"],
        "mode": mode,
    }


@router.get("/aisles")
def aisles():
    try:
        families = _aisle_rows(
            f"""
            SELECT NULLIF(LTRIM(RTRIM(i.item_family)), N'') AS value, COUNT(*) AS n
            {_INVENTORY_FROM}
            WHERE i.item IS NOT NULL AND LTRIM(RTRIM(i.item)) <> N'' {_EXCLUDE_SW}
            GROUP BY i.item_family
            ORDER BY COUNT(*) DESC
            """
        )
        categories = _aisle_rows(
            f"""
            SELECT NULLIF(LTRIM(RTRIM(i.emaint_category)), N'') AS value, COUNT(*) AS n
            {_INVENTORY_FROM}
            WHERE i.item IS NOT NULL AND LTRIM(RTRIM(i.item)) <> N'' {_EXCLUDE_SW}
            GROUP BY i.emaint_category
            ORDER BY COUNT(*) DESC
            """
        )
        manufacturers = _aisle_rows(
            f"""
            SELECT TOP 40 NULLIF(LTRIM(RTRIM(i.mfr)), N'') AS value, COUNT(*) AS n
            {_INVENTORY_FROM}
            WHERE i.item IS NOT NULL AND LTRIM(RTRIM(i.item)) <> N'' {_EXCLUDE_SW}
            GROUP BY i.mfr
            ORDER BY COUNT(*) DESC
            """
        )
        cabinets = _aisle_rows(
            f"""
            SELECT TOP 40 NULLIF(LTRIM(RTRIM(i.cabinet)), N'') AS value, COUNT(*) AS n
            {_INVENTORY_FROM}
            WHERE i.item IS NOT NULL AND LTRIM(RTRIM(i.item)) <> N'' {_EXCLUDE_SW}
              AND i.cabinet IS NOT NULL AND LTRIM(RTRIM(i.cabinet)) <> N''
            GROUP BY i.cabinet
            ORDER BY COUNT(*) DESC
            """
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    return {
        "families": families,
        "categories": categories,
        "manufacturers": manufacturers,
        "cabinets": cabinets,
    }


@router.get("")
def list_parts(
    q: str = Query("", max_length=120),
    family: str = Query("", max_length=80),
    category: str = Query("", max_length=80),
    mfr: str = Query("", max_length=80),
    cabinet: str = Query("", max_length=120),
    page: int = Query(1, ge=1),
    page_size: int = Query(48, ge=1, le=96),
):
    search = q.strip()
    like = f"%{search}%" if search else None
    filters_sql = _EXCLUDE_SW
    filter_params: list = []
    if family.strip():
        filters_sql += " AND i.item_family = %s"
        filter_params.append(family.strip())
    if category.strip():
        filters_sql += " AND i.emaint_category = %s"
        filter_params.append(category.strip())
    if mfr.strip():
        filters_sql += " AND i.mfr = %s"
        filter_params.append(mfr.strip())
    if cabinet.strip():
        filters_sql += " AND (i.cabinet = %s OR i.cabinet_2 = %s)"
        filter_params.extend([cabinet.strip(), cabinet.strip()])

    search_sql = ""
    search_params: tuple = ()
    if like:
        search_sql = """
            AND (
                i.item LIKE %s OR i.descrip LIKE %s OR i.mfr LIKE %s
                OR i.mfrpartno LIKE %s OR i.vpartno LIKE %s
                OR i.cabinet LIKE %s OR i.cabinet_2 LIKE %s
            )
        """
        search_params = (like,) * 7

    try:
        total = int(
            _field_query(
                f"""
                SELECT COUNT(*) AS n
                {_INVENTORY_FROM}
                WHERE i.item IS NOT NULL AND LTRIM(RTRIM(i.item)) <> N''
                  {filters_sql} {search_sql}
                """,
                tuple(filter_params) + search_params,
            )[0]["n"]
        )
        offset = (page - 1) * page_size
        rows = _field_query(
            f"""
            SELECT
                i.item, i.descrip, i.mfr, i.item_family, i.item_subcategory,
                i.emaint_category, i.cabinet, i.cabinet_2, i.mfrpartno, i.onhand, i.cost,
                i.photo_path, i.photo_path_2
            {_INVENTORY_FROM}
            WHERE i.item IS NOT NULL AND LTRIM(RTRIM(i.item)) <> N''
              {filters_sql} {search_sql}
            ORDER BY
                CASE WHEN i.photo_path IS NOT NULL AND LTRIM(RTRIM(i.photo_path)) <> N'' THEN 0 ELSE 1 END,
                i.descrip ASC
            OFFSET {offset} ROWS FETCH NEXT {page_size} ROWS ONLY
            """,
            tuple(filter_params) + search_params,
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc

    total_pages = max(1, math.ceil(total / page_size)) if total else 1
    return {
        "items": [_card(r) for r in rows],
        "page": page,
        "page_size": page_size,
        "total": total,
        "total_pages": total_pages,
    }


@router.get("/cart")
def get_cart(user=Depends(require_demo_user)):
    emp = _require_employee(user)
    try:
        lines = _cart_lines_for(emp)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    return {
        "mode": "server",
        "employee_id": emp,
        "lines": lines,
        "item_count": sum(int(x["qty"]) for x in lines),
        "line_count": len(lines),
    }


@router.put("/cart")
def put_cart(body: CartPutIn, user=Depends(require_demo_user)):
    """Replace cart, or merge guest lines into the signed-in cart."""
    emp = _require_employee(user)
    try:
        if not body.merge:
            _field_execute(
                "DELETE FROM inventory.parts_cart_line WHERE employee_id = %s",
                (emp,),
            )
        for line in body.lines:
            item = line.item.strip()
            if not item:
                continue
            _upsert_line(
                emp,
                item,
                int(line.qty),
                (line.note or "").strip() or None,
                add_qty=body.merge,
            )
        lines = _cart_lines_for(emp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    return {
        "mode": "server",
        "employee_id": emp,
        "lines": lines,
        "item_count": sum(int(x["qty"]) for x in lines),
        "line_count": len(lines),
    }


@router.post("/cart/items")
def add_cart_item(body: CartLineIn, user=Depends(require_demo_user)):
    emp = _require_employee(user)
    item = body.item.strip()
    try:
        _upsert_line(emp, item, int(body.qty), (body.note or "").strip() or None, add_qty=True)
        lines = _cart_lines_for(emp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    return {
        "mode": "server",
        "employee_id": emp,
        "lines": lines,
        "item_count": sum(int(x["qty"]) for x in lines),
        "line_count": len(lines),
    }


@router.patch("/cart/items/{item}")
def patch_cart_item(item: str, body: CartLineIn, user=Depends(require_demo_user)):
    emp = _require_employee(user)
    item_key = item.strip()
    try:
        _upsert_line(
            emp,
            item_key,
            int(body.qty),
            body.note if body.note is not None else None,
            add_qty=False,
        )
        lines = _cart_lines_for(emp)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    return {
        "mode": "server",
        "employee_id": emp,
        "lines": lines,
        "item_count": sum(int(x["qty"]) for x in lines),
        "line_count": len(lines),
    }


@router.delete("/cart/items/{item}")
def delete_cart_item(item: str, user=Depends(require_demo_user)):
    emp = _require_employee(user)
    item_key = item.strip()
    try:
        _field_execute(
            "DELETE FROM inventory.parts_cart_line WHERE employee_id = %s AND item = %s",
            (emp, item_key),
        )
        lines = _cart_lines_for(emp)
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    return {
        "mode": "server",
        "employee_id": emp,
        "lines": lines,
        "item_count": sum(int(x["qty"]) for x in lines),
        "line_count": len(lines),
    }


@router.delete("/cart")
def clear_cart(user=Depends(require_demo_user)):
    emp = _require_employee(user)
    try:
        _field_execute(
            "DELETE FROM inventory.parts_cart_line WHERE employee_id = %s",
            (emp,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    return {
        "mode": "server",
        "employee_id": emp,
        "lines": [],
        "item_count": 0,
        "line_count": 0,
    }


@router.get("/items/{item}")
def get_part(item: str):
    item_key = item.strip()
    if not item_key:
        raise HTTPException(status_code=400, detail="item is required")
    try:
        rows = _field_query(
            f"""
            SELECT
                i.item, i.descrip, i.mfr, i.item_family, i.item_subcategory,
                i.emaint_category, i.cabinet, i.cabinet_2, i.mfrpartno, i.onhand, i.cost,
                i.photo_path, i.photo_path_2
            {_INVENTORY_FROM}
            WHERE i.item = %s {_EXCLUDE_SW}
            """,
            (item_key,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    if not rows:
        raise HTTPException(status_code=404, detail=f"part not found: {item_key!r}")
    return _card(rows[0])


@router.get("/items/{item}/photo")
def get_photo(item: str, which: int = Query(1, ge=1, le=2)):
    item_key = item.strip()
    col = "photo_path_2" if which == 2 else "photo_path"
    try:
        rows = _field_query(
            f"SELECT i.{col} AS p FROM inventory.inventory AS i WHERE i.item = %s",
            (item_key,),
        )
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"database error: {exc}") from exc
    if not rows or not rows[0].get("p"):
        raise HTTPException(status_code=404, detail="photo not found")
    name = _filename_from_stored(_json_value(rows[0].get("p")))
    if not name or ".." in name:
        raise HTTPException(status_code=404, detail="photo not found")
    root = _photos_root()
    if root is None:
        raise HTTPException(status_code=503, detail="PARTS_PHOTOS_ROOT not configured")
    full = (root / name).resolve()
    if not str(full).startswith(str(root)) or not full.is_file():
        raise HTTPException(status_code=404, detail="photo not found")
    media_type, _ = mimetypes.guess_type(str(full))
    return FileResponse(
        full,
        media_type=media_type or "image/jpeg",
        headers={"Cache-Control": "private, max-age=86400"},
    )
