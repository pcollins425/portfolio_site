"""Work order materials + warehouse stock buckets (native ``wo`` / ``item`` FKs)."""

from __future__ import annotations

import re
import uuid
from decimal import Decimal

from app import emaint_demo_service as demo

BUCKET_WAREHOUSE = "WAREHOUSE"
BUCKET_FIELD = "FIELD"  # ledger destination for truck field issues (no balance row required)
COND_AVAILABLE = "AVAILABLE"
COND_REFURB = "REFURB"
COND_ALLOCATED = "ALLOCATED"
COND_DAMAGED = "DAMAGED"
COND_ISSUED = "ISSUED"

_VEHICLE_BUCKET = re.compile(r"^V\d+$", re.IGNORECASE)


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
        temp_ref = f"T{uuid.uuid4().hex[:12]}"
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
    temp_ref = f"M{uuid.uuid4().hex[:12]}"
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
        temp_ref = f"W{uuid.uuid4().hex[:12]}"
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


def search_inventory(*, q: str | None = None, limit: int = 25) -> dict:
    term = (q or "").strip()
    lim = max(1, min(int(limit), 100))
    if term:
        like = f"%{term}%"
        rows = demo._query(
            "SELECT TOP (%s) item, reference_key, descrip, onhand "
            "FROM [inventory].[inventory] "
            "WHERE [item] LIKE %s OR [descrip] LIKE %s OR [reference_key] LIKE %s "
            "ORDER BY [item] ASC",
            (lim, like, like, like),
        )
    else:
        rows = demo._query(
            "SELECT TOP (%s) item, reference_key, descrip, onhand "
            "FROM [inventory].[inventory] "
            "WHERE [item] IS NOT NULL "
            "ORDER BY [item] ASC",
            (lim,),
        )
    items = []
    for r in rows:
        row = demo._row_json(r)
        item = (row.get("item") or "").strip()
        if not item:
            continue
        try:
            row["stock"] = get_assignable_qty(item)
        except ValueError:
            row["stock"] = None
        items.append(row)
    return {"items": items}


def get_item_stock_summary(item: str) -> dict:
    base = get_assignable_qty(item)
    rows = demo._query(
        "SELECT bucket, condition, qty FROM [inventory].[stock_balance] "
        "WHERE [item] = %s AND [qty] > 0 ORDER BY [bucket], [condition]",
        (item.strip(),),
    )
    base["balances"] = [demo._row_json(r) for r in rows]
    return base


def _transfer_stock(
    *,
    item: str,
    qty: Decimal,
    from_bucket: str | None,
    from_condition: str | None,
    to_bucket: str,
    to_condition: str,
    wo: str | None = None,
    note: str | None = None,
    created_by: str | None = None,
    apply_to_balance: bool = True,
) -> None:
    if qty <= 0:
        raise ValueError("qty must be positive")
    if from_bucket and from_condition:
        available = _balance_qty(item, from_bucket, from_condition)
        if qty > available:
            raise ValueError(f"Only {available} available in {from_bucket}/{from_condition}")
        _apply_balance_delta(item, from_bucket, from_condition, -qty)
    if apply_to_balance:
        _apply_balance_delta(item, to_bucket, to_condition, qty)
    _record_movement(
        item=item,
        qty=qty,
        from_bucket=from_bucket,
        from_condition=from_condition,
        to_bucket=to_bucket,
        to_condition=to_condition,
        wo=wo,
        work_order_material_id=None,
        note=note,
        created_by=created_by,
    )


def list_good_source_buckets(item: str | None = None) -> list[dict]:
    """Non-vehicle buckets with AVAILABLE qty (Add Stock From picker).

    When ``item`` is set, qty is that part's AVAILABLE in each bucket — not a
    warehouse-wide total (which misled Add Stock into thinking stock existed).
    """
    item = (item or "").strip()
    if item:
        rows = demo._query(
            """
            SELECT bucket, qty
            FROM [inventory].[stock_balance]
            WHERE [item] = %s
              AND [condition] = %s
              AND [qty] > 0
              AND [bucket] NOT LIKE N'V%%'
              AND [bucket] NOT LIKE N'TRUCK:%%'
              AND UPPER([bucket]) <> N'DEFECT'
            ORDER BY bucket
            """,
            (item, COND_AVAILABLE),
        )
    else:
        rows = demo._query(
            """
            SELECT bucket, SUM(qty) AS qty
            FROM [inventory].[stock_balance]
            WHERE [condition] = %s
              AND [qty] > 0
              AND [bucket] NOT LIKE N'V%%'
              AND [bucket] NOT LIKE N'TRUCK:%%'
              AND UPPER([bucket]) <> N'DEFECT'
            GROUP BY bucket
            ORDER BY bucket
            """,
            (COND_AVAILABLE,),
        )
    return [
        {"bucket": (r.get("bucket") or "").strip(), "qty": float(_dec(r.get("qty")))}
        for r in rows
        if (r.get("bucket") or "").strip()
    ]


def truck_available_qty(item: str, truck_bucket: str) -> Decimal:
    return _balance_qty((item or "").strip(), (truck_bucket or "").strip().upper(), COND_AVAILABLE)


def add_stock_to_truck(
    *,
    item: str,
    qty: float,
    from_bucket: str,
    to_bucket: str,
    created_by: str | None = None,
) -> dict:
    """Move AVAILABLE stock from a warehouse-style bucket onto a vehicle bucket."""
    from app import stock_outbound_sync as outbound

    item = (item or "").strip()
    from_bucket = (from_bucket or "").strip()
    to_bucket = (to_bucket or "").strip().upper()
    if _inventory_row(item) is None:
        raise ValueError(f"Unknown item: {item}")
    if not from_bucket:
        raise ValueError("from_bucket is required")
    if not _VEHICLE_BUCKET.match(to_bucket):
        raise ValueError("to_bucket must be a vehicle code (V0xx)")
    if from_bucket.upper() == to_bucket:
        raise ValueError("from_bucket and to_bucket must differ")
    if from_bucket.upper() == "DEFECT" or from_bucket.upper().startswith("TRUCK:"):
        raise ValueError("from_bucket is not a valid good-stock source")
    q = _dec(qty)
    _transfer_stock(
        item=item,
        qty=q,
        from_bucket=from_bucket,
        from_condition=COND_AVAILABLE,
        to_bucket=to_bucket,
        to_condition=COND_AVAILABLE,
        note=f"add stock to truck {to_bucket} from {from_bucket}",
        created_by=created_by,
    )
    try:
        outbound.push_stock_outbound(item, [from_bucket, to_bucket])
    except Exception:
        # Reverse SQL transfer so AppSheet/eMaint failure does not leave drift.
        try:
            _transfer_stock(
                item=item,
                qty=q,
                from_bucket=to_bucket,
                from_condition=COND_AVAILABLE,
                to_bucket=from_bucket,
                to_condition=COND_AVAILABLE,
                note=f"rollback add stock to truck {to_bucket}",
                created_by=created_by,
            )
        except Exception:
            pass
        raise
    return {
        "item": item,
        "qty": float(q),
        "from_bucket": from_bucket,
        "to_bucket": to_bucket,
        "truck_available": float(truck_available_qty(item, to_bucket)),
    }


def issue_from_truck(
    *,
    item: str,
    qty: float,
    truck_bucket: str,
    wo: str | None = None,
    created_by: str | None = None,
) -> dict:
    """Pull good stock off a truck for field use (ledger to FIELD/ISSUED)."""
    from app import stock_outbound_sync as outbound

    item = (item or "").strip()
    truck_bucket = (truck_bucket or "").strip().upper()
    if _inventory_row(item) is None:
        raise ValueError(f"Unknown item: {item}")
    if not _VEHICLE_BUCKET.match(truck_bucket):
        raise ValueError("truck_bucket must be a vehicle code (V0xx)")
    q = _dec(qty)
    _transfer_stock(
        item=item,
        qty=q,
        from_bucket=truck_bucket,
        from_condition=COND_AVAILABLE,
        to_bucket=BUCKET_FIELD,
        to_condition=COND_ISSUED,
        wo=wo,
        note=f"issue from truck {truck_bucket} to WO {wo or ''}".strip(),
        created_by=created_by,
        apply_to_balance=False,
    )
    try:
        outbound.push_stock_outbound(item, [truck_bucket])
    except Exception:
        try:
            _apply_balance_delta(item, truck_bucket, COND_AVAILABLE, q)
        except Exception:
            pass
        raise
    return {
        "item": item,
        "qty": float(q),
        "truck_bucket": truck_bucket,
        "truck_available": float(truck_available_qty(item, truck_bucket)),
    }


def return_defective_to_truck(
    *,
    item: str,
    qty: float,
    truck_bucket: str,
    wo: str | None = None,
    created_by: str | None = None,
) -> dict:
    """Track a defective return on the tech's truck (DAMAGED)."""
    from app import stock_outbound_sync as outbound

    item = (item or "").strip()
    truck_bucket = (truck_bucket or "").strip().upper()
    if _inventory_row(item) is None:
        raise ValueError(f"Unknown item: {item}")
    if not _VEHICLE_BUCKET.match(truck_bucket):
        raise ValueError("truck_bucket must be a vehicle code (V0xx)")
    q = _dec(qty)
    _apply_balance_delta(item, truck_bucket, COND_DAMAGED, q)
    _record_movement(
        item=item,
        qty=q,
        from_bucket=BUCKET_FIELD,
        from_condition=COND_ISSUED,
        to_bucket=truck_bucket,
        to_condition=COND_DAMAGED,
        wo=wo,
        work_order_material_id=None,
        note=f"defective return to truck {truck_bucket} WO {wo or ''}".strip(),
        created_by=created_by,
    )
    try:
        outbound.push_stock_outbound(item, [truck_bucket])
    except Exception:
        try:
            _apply_balance_delta(item, truck_bucket, COND_DAMAGED, -q)
        except Exception:
            pass
        raise
    return {
        "item": item,
        "qty": float(q),
        "truck_bucket": truck_bucket,
        "truck_damaged": float(_balance_qty(item, truck_bucket, COND_DAMAGED)),
    }


def move_to_refurb(
    *,
    item: str,
    qty: float,
    from_available: bool = True,
    created_by: str | None = None,
) -> dict:
    item = (item or "").strip()
    if _inventory_row(item) is None:
        raise ValueError(f"Unknown item: {item}")
    q = _dec(qty)
    if from_available:
        _transfer_stock(
            item=item,
            qty=q,
            from_bucket=BUCKET_WAREHOUSE,
            from_condition=COND_AVAILABLE,
            to_bucket=BUCKET_WAREHOUSE,
            to_condition=COND_REFURB,
            note="move to refurb from available",
            created_by=created_by,
        )
    else:
        _apply_balance_delta(item, BUCKET_WAREHOUSE, COND_REFURB, q)
        _record_movement(
            item=item,
            qty=q,
            from_bucket=None,
            from_condition=None,
            to_bucket=BUCKET_WAREHOUSE,
            to_condition=COND_REFURB,
            note="field return to refurb",
            created_by=created_by,
        )
    return get_item_stock_summary(item)


def load_truck(
    *,
    assignid: str,
    item: str,
    qty: float,
    created_by: str | None = None,
) -> dict:
    assignid = (assignid or "").strip()
    item = (item or "").strip()
    if not assignid:
        raise ValueError("assignid is required")
    if _inventory_row(item) is None:
        raise ValueError(f"Unknown item: {item}")
    q = _dec(qty)
    truck_bucket = f"TRUCK:{assignid}"
    _transfer_stock(
        item=item,
        qty=q,
        from_bucket=BUCKET_WAREHOUSE,
        from_condition=COND_AVAILABLE,
        to_bucket=truck_bucket,
        to_condition=COND_AVAILABLE,
        note=f"load truck {assignid}",
        created_by=created_by,
    )
    return list_truck_stock(assignid)


def list_field_techs(*, q: str | None = None, limit: int = 50, offset: int = 0) -> dict:
    term = (q or "").strip()
    lim = max(1, min(int(limit), 200))
    off = max(0, int(offset))
    where = "WHERE [assignid] IS NOT NULL AND LTRIM([assignid]) <> N''"
    params: list = []
    if term:
        where += " AND ([assignto] LIKE %s OR [assignid] LIKE %s)"
        like = f"%{term}%"
        params.extend([like, like])
    count_sql = (
        "SELECT COUNT(*) AS n FROM ("
        "SELECT DISTINCT [assignid], [assignto] FROM [projects].[work_orders] "
        f"{where}"
        ") AS d"
    )
    total = int(demo._query(count_sql, tuple(params) if params else None)[0]["n"])
    rows = demo._query(
        "SELECT [assignid], [assignto], COUNT(*) AS open_wo_count "
        "FROM [projects].[work_orders] "
        f"{where} "
        "GROUP BY [assignid], [assignto] "
        "ORDER BY [assignto] ASC "
        "OFFSET %s ROWS FETCH NEXT %s ROWS ONLY",
        tuple([*params, off, lim]),
    )
    out = []
    for r in rows:
        row = demo._row_json(r)
        aid = (row.get("assignid") or "").strip()
        if aid:
            try:
                row["truck"] = list_truck_stock(aid)
            except ValueError:
                row["truck"] = {"lines": []}
        out.append(row)
    return {"rows": out, "total": total, "limit": lim, "offset": off}


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
