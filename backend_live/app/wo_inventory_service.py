"""Work order materials + warehouse stock buckets (native ``wo`` / ``item`` FKs)."""

from __future__ import annotations

import uuid
from decimal import Decimal

from app import emaint_demo_service as demo

BUCKET_WAREHOUSE = "WAREHOUSE"
COND_AVAILABLE = "AVAILABLE"
COND_ALLOCATED = "ALLOCATED"


def _dec(v) -> Decimal:
    if v is None:
        return Decimal("0")
    if isinstance(v, Decimal):
        return v
    return Decimal(str(v))


def resolve_work_order(wo_key: str) -> dict:
    """Resolve browse key (uuid or wo number) to native ``wo`` + row."""
    spec = demo._table_spec("work_orders")
    where_sql, where_params = demo._where_for_key(spec, wo_key)
    table = demo._qualified_table(spec)
    sql = (
        f"SELECT TOP 1 wo, reference_key, assignto, assignid, brief_desc, stattype "
        f"FROM {table} WHERE {where_sql}"
    )
    rows = demo._query(sql, where_params)
    if not rows:
        raise ValueError("Work order not found")
    row = demo._row_json(rows[0])
    wo = (row.get("wo") or "").strip()
    if not wo:
        raise ValueError("Work order has no WO number yet (assign wo before materials)")
    row["wo"] = wo
    return row


def _inventory_row(item: str) -> dict | None:
    item = (item or "").strip()
    if not item:
        raise ValueError("item is required")
    rows = demo._query(
        "SELECT TOP 1 item, reference_key, descrip, onhand "
        "FROM [inventory].[inventory] WHERE [item] = %s",
        (item,),
    )
    if not rows:
        return None
    return demo._row_json(rows[0])


def get_assignable_qty(item: str) -> dict:
    item = (item or "").strip()
    inv = _inventory_row(item)
    if inv is None:
        raise ValueError(f"Unknown item: {item}")

    bal_rows = demo._query(
        "SELECT [condition], qty FROM [inventory].[stock_balance] "
        "WHERE [item] = %s AND [bucket] = %s",
        (item, BUCKET_WAREHOUSE),
    )
    available = Decimal("0")
    refurb = Decimal("0")
    for r in bal_rows:
        cond = (r.get("condition") or "").strip().upper()
        q = _dec(r.get("qty"))
        if cond == COND_AVAILABLE:
            available = q
        elif cond == "REFURB":
            refurb = q

    onhand = _dec(inv.get("onhand"))
    return {
        "item": item,
        "reference_key": inv.get("reference_key"),
        "descrip": inv.get("descrip"),
        "onhand": float(onhand),
        "qty_available": float(available),
        "qty_refurb": float(refurb),
        "qty_assignable": float(available),
    }


def _balance_qty(item: str, bucket: str, condition: str) -> Decimal:
    rows = demo._query(
        "SELECT qty FROM [inventory].[stock_balance] "
        "WHERE [item] = %s AND [bucket] = %s AND [condition] = %s",
        (item, bucket, condition),
    )
    if not rows:
        return Decimal("0")
    return _dec(rows[0].get("qty"))


def _apply_balance_delta(item: str, bucket: str, condition: str, delta: Decimal) -> None:
    if delta == 0:
        return
    current = _balance_qty(item, bucket, condition)
    new_qty = current + delta
    if new_qty < 0:
        raise ValueError(
            f"Insufficient stock for {item} in {bucket}/{condition} "
            f"(have {current}, need {-delta})"
        )
    if current == 0 and delta > 0:
        temp_ref = f"TEMP-STB-{uuid.uuid4().hex[:12]}"
        demo._execute(
            "INSERT INTO [inventory].[stock_balance] "
            "(reference_key, item, bucket, condition, qty) VALUES (%s, %s, %s, %s, %s)",
            (temp_ref, item, bucket, condition, float(new_qty)),
        )
        return
    demo._execute(
        "UPDATE [inventory].[stock_balance] SET qty = %s, updated_at = SYSUTCDATETIME() "
        "WHERE [item] = %s AND [bucket] = %s AND [condition] = %s",
        (float(new_qty), item, bucket, condition),
    )


def _record_movement(
    *,
    item: str,
    qty: Decimal,
    from_bucket: str | None,
    from_condition: str | None,
    to_bucket: str,
    to_condition: str,
    wo: str | None,
    work_order_material_id: str | None,
    note: str | None,
    created_by: str | None,
) -> None:
    temp_ref = f"TEMP-STM-{uuid.uuid4().hex[:12]}"
    demo._execute(
        "INSERT INTO [inventory].[stock_movement] "
        "(reference_key, item, from_bucket, from_condition, to_bucket, to_condition, "
        " qty, wo, work_order_material_id, note, created_by) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            temp_ref,
            item,
            from_bucket,
            from_condition,
            to_bucket,
            to_condition,
            float(qty),
            wo,
            work_order_material_id,
            note,
            created_by,
        ),
    )


def list_materials(wo_key: str) -> dict:
    wo_row = resolve_work_order(wo_key)
    wo = wo_row["wo"]
    rows = demo._query(
        "SELECT reference_key, wo, item, qty_requested, qty_allocated, qty_issued, status, "
        "       created_at, updated_at "
        "FROM [projects].[work_order_material] WHERE [wo] = %s ORDER BY [item] ASC",
        (wo,),
    )
    lines = []
    for r in rows:
        line = demo._row_json(r)
        item = line["item"]
        try:
            line["assignable"] = get_assignable_qty(item)
        except ValueError:
            line["assignable"] = None
        lines.append(line)
    return {"wo": wo, "work_order": wo_row, "lines": lines}


def upsert_material_line(*, wo_key: str, item: str, qty_requested: float) -> dict:
    wo_row = resolve_work_order(wo_key)
    wo = wo_row["wo"]
    item = (item or "").strip()
    if not item:
        raise ValueError("item is required")
    if _inventory_row(item) is None:
        raise ValueError(f"Unknown item: {item}")
    qty = _dec(qty_requested)
    if qty <= 0:
        raise ValueError("qty_requested must be positive")

    existing = demo._query(
        "SELECT reference_key, qty_requested, qty_allocated FROM [projects].[work_order_material] "
        "WHERE [wo] = %s AND [item] = %s",
        (wo, item),
    )
    if existing:
        ref = existing[0]["reference_key"]
        demo._execute(
            "UPDATE [projects].[work_order_material] "
            "SET qty_requested = %s, updated_at = SYSUTCDATETIME() "
            "WHERE [reference_key] = %s",
            (float(qty), ref),
        )
    else:
        temp_ref = f"TEMP-WOM-{uuid.uuid4().hex[:12]}"
        demo._execute(
            "INSERT INTO [projects].[work_order_material] "
            "(reference_key, wo, item, qty_requested, status) VALUES (%s, %s, %s, %s, N'draft')",
            (temp_ref, wo, item, float(qty)),
        )

    return list_materials(wo_key)


def allocate_material(
    *,
    wo_key: str,
    item: str,
    qty: float | None = None,
    created_by: str | None = None,
) -> dict:
    wo_row = resolve_work_order(wo_key)
    wo = wo_row["wo"]
    item = (item or "").strip()
    if not item:
        raise ValueError("item is required")

    line_rows = demo._query(
        "SELECT reference_key, qty_requested, qty_allocated, status "
        "FROM [projects].[work_order_material] WHERE [wo] = %s AND [item] = %s",
        (wo, item),
    )
    if not line_rows:
        raise ValueError("No material line for this item — add a line first")
    line = line_rows[0]
    wom_ref = line["reference_key"]
    requested = _dec(line.get("qty_requested"))
    already = _dec(line.get("qty_allocated"))
    need = requested - already
    if need <= 0:
        raise ValueError("Line is already fully allocated")

    to_allocate = need if qty is None else _dec(qty)
    if to_allocate <= 0:
        raise ValueError("qty must be positive")
    if to_allocate > need:
        raise ValueError(f"Cannot allocate more than remaining need ({need})")

    assignable = _balance_qty(item, BUCKET_WAREHOUSE, COND_AVAILABLE)
    if to_allocate > assignable:
        raise ValueError(
            f"Only {assignable} assignable in warehouse (requested allocate {to_allocate})"
        )

    wo_bucket = f"WO:{wo}"
    _apply_balance_delta(item, BUCKET_WAREHOUSE, COND_AVAILABLE, -to_allocate)
    _apply_balance_delta(item, wo_bucket, COND_ALLOCATED, to_allocate)
    _record_movement(
        item=item,
        qty=to_allocate,
        from_bucket=BUCKET_WAREHOUSE,
        from_condition=COND_AVAILABLE,
        to_bucket=wo_bucket,
        to_condition=COND_ALLOCATED,
        wo=wo,
        work_order_material_id=wom_ref,
        note="allocate to work order",
        created_by=created_by,
    )

    new_allocated = already + to_allocate
    status = "allocated" if new_allocated >= requested else "draft"
    if new_allocated > 0:
        status = "allocated"
    demo._execute(
        "UPDATE [projects].[work_order_material] "
        "SET qty_allocated = %s, status = %s, updated_at = SYSUTCDATETIME() "
        "WHERE [reference_key] = %s",
        (float(new_allocated), status, wom_ref),
    )

    return {
        "ok": True,
        "wo": wo,
        "item": item,
        "qty_allocated": float(to_allocate),
        "materials": list_materials(wo_key),
    }


def list_truck_stock(assignid: str) -> dict:
    assignid = (assignid or "").strip()
    if not assignid:
        raise ValueError("assignid is required")
    bucket = f"TRUCK:{assignid}"
    rows = demo._query(
        "SELECT b.item, b.condition, b.qty, i.descrip, i.reference_key "
        "FROM [inventory].[stock_balance] AS b "
        "INNER JOIN [inventory].[inventory] AS i ON i.item = b.item "
        "WHERE b.bucket = %s AND b.qty > 0 "
        "ORDER BY b.item ASC",
        (bucket,),
    )
    return {
        "assignid": assignid,
        "bucket": bucket,
        "lines": [demo._row_json(r) for r in rows],
    }
