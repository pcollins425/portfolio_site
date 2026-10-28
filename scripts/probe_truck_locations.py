"""One-shot: list AppSheet Vehicle Locations + sample stock_balance for a truck."""
from __future__ import annotations

import json
import sys

from app import appsheet_client, mssql


def main() -> int:
    rows = appsheet_client.find_rows(
        appsheet_client.LOCATIONS_TABLE,
        selector='FILTER(Locations, [Type] = "Vehicle")',
    )
    vehicles = []
    missing = []
    for r in rows:
        code = (
            (r.get("Location ID (Key)") or "").strip()
            or (r.get("Warehouse") or "").strip()
            or (r.get("Name") or "").strip()
        )
        # Prefer Warehouse / explicit location code fields when Name is the label key
        for key in ("Location ID (Key)", "Warehouse", "Ship To Location"):
            val = (r.get(key) or "").strip()
            if val and val.upper().startswith("V"):
                code = val
                break
        name = (r.get("Name") or "").strip()
        email = (r.get("Assigned User (Email)") or "").strip()
        item = {
            "code": code,
            "name": name,
            "email": email,
            "type": (r.get("Type") or "").strip(),
            "warehouse": (r.get("Warehouse") or "").strip(),
            "raw_keys": sorted(r.keys()),
        }
        vehicles.append(item)
        if not email:
            missing.append(item)

    print("COUNT", len(vehicles))
    print("MISSING_EMAIL", len(missing))
    if rows:
        print("SAMPLE_KEYS", sorted(rows[0].keys()))
    print(json.dumps({"vehicles": vehicles, "missing_email": missing}, indent=2))

    sample_code = None
    for v in vehicles:
        c = (v.get("code") or v.get("warehouse") or "").strip()
        if c.upper().startswith("V"):
            sample_code = c
            break
    if not sample_code and vehicles:
        sample_code = vehicles[0].get("warehouse") or vehicles[0].get("code")

    if sample_code:
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
            params=(sample_code,),
            database="dgs_application_db",
            profile="field",
            load_env=False,
        )
        print("STOCK_SAMPLE_BUCKET", sample_code, "rows", len(bal))
        print(json.dumps(bal, indent=2, default=str)[:4000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
