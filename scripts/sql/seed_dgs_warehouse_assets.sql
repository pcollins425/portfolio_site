/*
  Warehouse + Assets inventory areas (hide from Technicians).

  - dgs_warehouse / dgs_assets: every role except Technician
  Idempotent. Re-login after apply (JWT caches role permissions).
*/
USE [dgs_application_db];
GO

DECLARE @wh NVARCHAR(80) = N'dgs_warehouse: READ_ONLY';
DECLARE @assets NVARCHAR(80) = N'dgs_assets: READ_ONLY';

UPDATE r
SET
    r.permissions = CASE
        WHEN CHARINDEX(N'dgs_warehouse:', ISNULL(r.permissions, N'')) > 0
         AND CHARINDEX(N'dgs_assets:', ISNULL(r.permissions, N'')) > 0
            THEN r.permissions
        WHEN r.permissions IS NULL OR LTRIM(RTRIM(r.permissions)) = N''
            THEN @wh + N', ' + @assets
        ELSE
            LTRIM(RTRIM(r.permissions))
            + CASE WHEN CHARINDEX(N'dgs_warehouse:', ISNULL(r.permissions, N'')) > 0
                   THEN N'' ELSE N', ' + @wh END
            + CASE WHEN CHARINDEX(N'dgs_assets:', ISNULL(r.permissions, N'')) > 0
                   THEN N'' ELSE N', ' + @assets END
    END
FROM employees.roles AS r
WHERE r.role <> N'Technician'
  AND (r.reference_key IS NULL OR r.reference_key <> N'RT-030');
GO

/* Refresh combined_permissions for non-tech employees */
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
  AND (r.reference_key IS NULL OR r.reference_key <> N'RT-030');
GO

SELECT
    role,
    CASE WHEN CHARINDEX(N'dgs_warehouse:', ISNULL(permissions, N'')) > 0 THEN 1 ELSE 0 END AS has_warehouse,
    CASE WHEN CHARINDEX(N'dgs_assets:', ISNULL(permissions, N'')) > 0 THEN 1 ELSE 0 END AS has_assets
FROM employees.roles
ORDER BY role;
GO
