"""One-shot: list AppSheet Vehicle Locations + sample stock_balance for a truck."""
from __future__ import annotations

import json
import sys

from app import appsheet_client, mssql


def _location_code(row: dict) -> str:
    for key in (
        "Location ID (Key)NameType",
        "Location ID (Key)",
        "Warehouse",
    ):
        val = (row.get(key) or "").strip()
        if val:
            return val
    return (row.get("Name") or "").strip()


def main() -> int:
    rows = appsheet_client.find_rows(
        appsheet_client.LOCATIONS_TABLE,
        selector='FILTER(Locations, [Type] = "Vehicle")',
    )
    vehicles = []
    missing = []
    for r in rows:
        code = _location_code(r)
        name = (r.get("Name") or "").strip()
        email = (r.get("Assigned User (Email)") or "").strip()
        item = {
            "code": code,
            "name": name,
            "email": email,
            "type": (r.get("Type") or "").strip(),
            "warehouse": (r.get("Warehouse") or "").strip(),
        }
        vehicles.append(item)
        if not email:
            missing.append(item)

    print("COUNT", len(vehicles))
    print("MISSING_EMAIL", len(missing))
    print(json.dumps({"vehicles": vehicles, "missing_email": missing}, indent=2))

    sample = next(
        (v["code"] for v in vehicles if (v.get("code") or "").upper().startswith("V")),
        None,
    )
    if sample:
        bal = mssql.query(
            """
            SELECT TOP 15
                sb.item,
                sb.bucket,
                sb.condition,
                sb.qty,
                i.descrip
            FROM inventory.stock_balance AS sb
            LEFT JOIN inventory.inventory AS i ON i.item = sb.item
            WHERE sb.bucket = %s AND sb.qty > 0
            ORDER BY sb.qty DESC
            """,
            params=(sample,),
            database="dgs_application_db",
            profile="field",
            load_env=False,
        )
        print("STOCK_SAMPLE_BUCKET", sample, "rows", len(bal))
        print(json.dumps(bal, indent=2, default=str)[:4000])

    buckets = mssql.query(
        """
        SELECT TOP 40 bucket, COUNT(*) AS c, SUM(CASE WHEN qty > 0 THEN 1 ELSE 0 END) AS with_qty
        FROM inventory.stock_balance
        WHERE bucket LIKE 'V%'
        GROUP BY bucket
        ORDER BY bucket
        """,
        database="dgs_application_db",
        profile="field",
        load_env=False,
    )
    print("VEHICLE_BUCKETS", json.dumps(buckets, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
