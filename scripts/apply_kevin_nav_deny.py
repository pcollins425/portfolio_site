"""Kevin P — deny Executive/Market/Performance, Contracts, Deals, Software Vault, Employees."""
from __future__ import annotations

from app import mssql
from app import permission_catalog as cat

DB = "dgs_application_db"
KEVIN_ID = "EMP-000075"

DENY_AREAS = (
    "dgs_performance",  # Executive, Market, Performance dashboards
    "dgs_contracts",
    "dgs_deals",
    "dgs_software_vault",
    "employees",
    "roles",
)


def main() -> None:
    rows = mssql.query(
        """
        SELECT
            er.reference_key,
            er.name,
            er.email,
            er.override_permissions,
            r.permissions AS role_permissions
        FROM employees.employee_roles AS er
        LEFT JOIN employees.roles AS r ON r.reference_key = er.role_id
        WHERE er.reference_key = %s
           OR LOWER(LTRIM(RTRIM(er.email))) = N'kevinperchalski@dynamicgamingsolutions.com'
        """,
        params=(KEVIN_ID,),
        database=DB,
        load_env=False,
    )
    if not rows:
        raise SystemExit("Kevin employee row not found")

    for row in rows:
        merged = cat.parse_permissions_blob(row.get("override_permissions"))
        for area in DENY_AREAS:
            merged[area] = cat.LEVEL_NONE
        new_override = cat.serialize_permissions(merged)

        n = mssql.execute(
            """
            UPDATE employees.employee_roles
            SET
                override_permissions = %s,
                update_date = GETDATE(),
                update_by = N'kevin_nav_deny'
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
        print("rows", n, "emp", row.get("reference_key"), row.get("name"), row.get("email"))
        print("override", new_override)
        for area in DENY_AREAS:
            print(" ", area, "effective=", eff.get(area))


if __name__ == "__main__":
    main()
