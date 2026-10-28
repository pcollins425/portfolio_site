"""Apply Truck/Parts inventory permission seed via field MSSQL profile."""
from __future__ import annotations

from app import mssql

DB = "dgs_application_db"


def ex(sql: str) -> int:
    return mssql.execute(sql, database=DB, profile="field", load_env=False)


def q(sql: str):
    return mssql.query(sql, database=DB, profile="field", load_env=False)


def main() -> None:
    n = ex(
        """
        UPDATE employees.roles
        SET permissions = CASE
            WHEN CHARINDEX(N'dgs_truck_inventory:', ISNULL(permissions, N'')) > 0
                THEN permissions
            WHEN permissions IS NULL OR LTRIM(RTRIM(permissions)) = N''
                THEN N'dgs_truck_inventory: READ_ONLY'
            ELSE LTRIM(RTRIM(permissions)) + N', dgs_truck_inventory: READ_ONLY'
        END
        WHERE reference_key = N'RT-030' OR role = N'Technician'
        """
    )
    print("technician truck grant rows", n)

    n = ex(
        """
        UPDATE employees.roles
        SET permissions = CASE
            WHEN CHARINDEX(N'dgs_parts_inventory:', ISNULL(permissions, N'')) > 0
                THEN permissions
            WHEN permissions IS NULL OR LTRIM(RTRIM(permissions)) = N''
                THEN N'dgs_parts_inventory: READ_ONLY'
            ELSE LTRIM(RTRIM(permissions)) + N', dgs_parts_inventory: READ_ONLY'
        END
        WHERE reference_key IN (
            N'RT-018', N'RT-016', N'RT-021', N'RT-031', N'RT-032'
        )
        """
    )
    print("office roles parts grant rows", n)

    n = ex(
        """
        UPDATE employees.employee_roles
        SET
            override_permissions = CASE
                WHEN CHARINDEX(N'dgs_truck_inventory:', ISNULL(override_permissions, N'')) > 0
                 AND CHARINDEX(N'dgs_parts_inventory:', ISNULL(override_permissions, N'')) > 0
                    THEN override_permissions
                WHEN override_permissions IS NULL OR LTRIM(RTRIM(override_permissions)) = N''
                    THEN N'dgs_truck_inventory: READ_ONLY, dgs_parts_inventory: READ_ONLY'
                ELSE
                    LTRIM(RTRIM(override_permissions))
                    + CASE
                        WHEN CHARINDEX(N'dgs_truck_inventory:', ISNULL(override_permissions, N'')) > 0
                        THEN N''
                        ELSE N', dgs_truck_inventory: READ_ONLY'
                      END
                    + CASE
                        WHEN CHARINDEX(N'dgs_parts_inventory:', ISNULL(override_permissions, N'')) > 0
                        THEN N''
                        ELSE N', dgs_parts_inventory: READ_ONLY'
                      END
            END,
            update_date = GETDATE(),
            update_by = N'dgs_truck_parts_inventory seed'
        WHERE reference_key IN (N'EMP-000040', N'EMP-000075', N'EMP-000068')
           OR LOWER(LTRIM(RTRIM(email))) IN (
                N'paulc@dynamicgamingsolutions.com',
                N'kevinperchalski@dynamicgamingsolutions.com',
                N'barryd@dynamicgamingsolutions.com'
              )
        """
    )
    print("paul/kevin/barry override rows", n)

    n = ex(
        """
        UPDATE er
        SET
            er.combined_permissions = CASE
                WHEN r.permissions IS NULL OR LTRIM(RTRIM(r.permissions)) = N''
                    THEN er.override_permissions
                WHEN er.override_permissions IS NULL OR LTRIM(RTRIM(er.override_permissions)) = N''
                    THEN r.permissions
                ELSE LTRIM(RTRIM(r.permissions)) + N', ' + LTRIM(RTRIM(er.override_permissions))
            END,
            er.update_date = GETDATE(),
            er.update_by = N'dgs_truck_parts_inventory seed'
        FROM employees.employee_roles AS er
        LEFT JOIN employees.roles AS r ON r.reference_key = er.role_id
        WHERE er.reference_key IN (N'EMP-000040', N'EMP-000075', N'EMP-000068')
           OR r.reference_key IN (
                N'RT-030', N'RT-018', N'RT-016', N'RT-021', N'RT-031', N'RT-032'
              )
        """
    )
    print("combined refresh rows", n)

    print(
        "people",
        q(
            """
            SELECT reference_key, name,
                CASE WHEN CHARINDEX(N'dgs_truck_inventory:',
                    ISNULL(combined_permissions, N'') + N',' + ISNULL(override_permissions, N'')) > 0
                    THEN 1 ELSE 0 END AS has_truck,
                CASE WHEN CHARINDEX(N'dgs_parts_inventory:',
                    ISNULL(combined_permissions, N'') + N',' + ISNULL(override_permissions, N'')) > 0
                    THEN 1 ELSE 0 END AS has_parts
            FROM employees.employee_roles
            WHERE reference_key IN (N'EMP-000040', N'EMP-000075', N'EMP-000068')
            """
        ),
    )
    print(
        "roles",
        q(
            """
            SELECT reference_key, role,
                CASE WHEN CHARINDEX(N'dgs_truck_inventory:', ISNULL(permissions, N'')) > 0
                    THEN 1 ELSE 0 END AS has_truck,
                CASE WHEN CHARINDEX(N'dgs_parts_inventory:', ISNULL(permissions, N'')) > 0
                    THEN 1 ELSE 0 END AS has_parts
            FROM employees.roles
            WHERE reference_key IN (N'RT-030', N'RT-031', N'RT-018')
            """
        ),
    )


if __name__ == "__main__":
    main()
