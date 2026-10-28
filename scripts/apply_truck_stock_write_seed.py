"""Paul + Kevin — truck inventory write (add stock)."""
from __future__ import annotations

from app import mssql
from app import permission_catalog as cat

DB = "dgs_application_db"
GRANT_LEVEL = cat.LEVEL_ADDS_UPDATES
AREA = cat.TRUCK_INVENTORY_AREA
TARGETS = (
    ("EMP-000040", "paulc@dynamicgamingsolutions.com"),
    ("EMP-000075", "kevinperchalski@dynamicgamingsolutions.com"),
)


def main() -> None:
    for emp_id, email in TARGETS:
        rows = mssql.query(
            """
            SELECT er.reference_key, er.name, er.override_permissions, r.permissions AS role_permissions
            FROM employees.employee_roles AS er
            LEFT JOIN employees.roles AS r ON r.reference_key = er.role_id
            WHERE er.reference_key = %s
               OR LOWER(LTRIM(RTRIM(er.email))) = %s
            """,
            params=(emp_id, email.lower()),
            database=DB,
            load_env=False,
        )
        if not rows:
            print("missing", emp_id, email)
            continue
        for row in rows:
            merged = cat.parse_permissions_blob(row.get("override_permissions"))
            merged[AREA] = GRANT_LEVEL
            new_override = cat.serialize_permissions(merged)
            mssql.execute(
                """
                UPDATE employees.employee_roles
                SET
                    override_permissions = %s,
                    update_date = GETDATE(),
                    update_by = N'truck_stock_write_seed'
                WHERE reference_key = %s
                """,
                params=(new_override, row["reference_key"]),
                database=DB,
                profile="field",
                load_env=False,
            )
            mssql.execute(
                """
                UPDATE er
                SET er.combined_permissions = CASE
                    WHEN r.permissions IS NULL OR LTRIM(RTRIM(r.permissions)) = N''
                        THEN er.override_permissions
                    WHEN er.override_permissions IS NULL OR LTRIM(RTRIM(er.override_permissions)) = N''
                        THEN r.permissions
                    ELSE LTRIM(RTRIM(r.permissions)) + N', ' + LTRIM(RTRIM(er.override_permissions))
                END
                FROM employees.employee_roles AS er
                INNER JOIN employees.roles AS r ON r.reference_key = er.role_id
                WHERE er.reference_key = %s
                """,
                params=(row["reference_key"],),
                database=DB,
                profile="field",
                load_env=False,
            )
            eff = cat.merge_permissions(row.get("role_permissions"), new_override)
            print("updated", row["reference_key"], row.get("name"), AREA, "->", eff.get(AREA))


if __name__ == "__main__":
    main()
