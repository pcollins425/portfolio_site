"""Grant Warehouse/Assets areas to every role except Technician."""
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
            WHEN CHARINDEX(N'dgs_warehouse:', ISNULL(permissions, N'')) > 0
             AND CHARINDEX(N'dgs_assets:', ISNULL(permissions, N'')) > 0
                THEN permissions
            WHEN permissions IS NULL OR LTRIM(RTRIM(permissions)) = N''
                THEN N'dgs_warehouse: READ_ONLY, dgs_assets: READ_ONLY'
            ELSE
                LTRIM(RTRIM(permissions))
                + CASE
                    WHEN CHARINDEX(N'dgs_warehouse:', ISNULL(permissions, N'')) > 0
                    THEN N''
                    ELSE N', dgs_warehouse: READ_ONLY'
                  END
                + CASE
                    WHEN CHARINDEX(N'dgs_assets:', ISNULL(permissions, N'')) > 0
                    THEN N''
                    ELSE N', dgs_assets: READ_ONLY'
                  END
        END
        WHERE role <> N'Technician'
          AND (reference_key IS NULL OR reference_key <> N'RT-030')
        """
    )
    print("non-tech role grants", n)

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
            er.update_by = N'dgs_warehouse_assets seed'
        FROM employees.employee_roles AS er
        INNER JOIN employees.roles AS r ON r.reference_key = er.role_id
        WHERE r.role <> N'Technician'
          AND (r.reference_key IS NULL OR r.reference_key <> N'RT-030')
        """
    )
    print("combined_permissions refresh", n)

    rows = q(
        """
        SELECT
            role,
            CASE WHEN CHARINDEX(N'dgs_warehouse:', ISNULL(permissions, N'')) > 0 THEN 1 ELSE 0 END AS has_warehouse,
            CASE WHEN CHARINDEX(N'dgs_assets:', ISNULL(permissions, N'')) > 0 THEN 1 ELSE 0 END AS has_assets
        FROM employees.roles
        ORDER BY role
        """
    )
    for row in rows:
        print(row)


if __name__ == "__main__":
    main()
