/*
  Truck + Parts inventory nav/API areas.

  - dgs_truck_inventory: Technician role + Paul / Kevin / Barry
  - dgs_parts_inventory: warehouse/office roles + Paul / Kevin / Barry (not Technician)

  Idempotent. Re-login after apply (JWT caches permissions).
*/
USE [dgs_application_db];
GO

DECLARE @truck NVARCHAR(80) = N'dgs_truck_inventory: READ_ONLY';
DECLARE @parts NVARCHAR(80) = N'dgs_parts_inventory: READ_ONLY';

/* Technician role — Truck only */
UPDATE r
SET
    r.permissions = CASE
        WHEN CHARINDEX(N'dgs_truck_inventory:', ISNULL(r.permissions, N'')) > 0
            THEN r.permissions
        WHEN r.permissions IS NULL OR LTRIM(RTRIM(r.permissions)) = N''
            THEN @truck
        ELSE LTRIM(RTRIM(r.permissions)) + N', ' + @truck
    END
FROM employees.roles AS r
WHERE r.reference_key = N'RT-030'
   OR r.role = N'Technician';
GO

/* Warehouse / office roles that already browse inventory — Parts */
UPDATE r
SET
    r.permissions = CASE
        WHEN CHARINDEX(N'dgs_parts_inventory:', ISNULL(r.permissions, N'')) > 0
            THEN r.permissions
        WHEN r.permissions IS NULL OR LTRIM(RTRIM(r.permissions)) = N''
            THEN N'dgs_parts_inventory: READ_ONLY'
        ELSE LTRIM(RTRIM(r.permissions)) + N', dgs_parts_inventory: READ_ONLY'
    END
FROM employees.roles AS r
WHERE r.reference_key IN (
        N'RT-018', -- Admin
        N'RT-016', -- Manager
        N'RT-021', -- Operations
        N'RT-031', -- Inventory
        N'RT-032'  -- eMaint Demo (beta)
    )
   OR r.role IN (N'Admin', N'Manager', N'Operations', N'Inventory', N'eMaint Demo (beta)');
GO

/* Paul, Kevin, Barry — Truck + Parts on overrides */
DECLARE @both NVARCHAR(120) = N'dgs_truck_inventory: READ_ONLY, dgs_parts_inventory: READ_ONLY';

UPDATE er
SET
    er.override_permissions = CASE
        WHEN CHARINDEX(N'dgs_truck_inventory:', ISNULL(er.override_permissions, N'')) > 0
         AND CHARINDEX(N'dgs_parts_inventory:', ISNULL(er.override_permissions, N'')) > 0
            THEN er.override_permissions
        WHEN er.override_permissions IS NULL OR LTRIM(RTRIM(er.override_permissions)) = N''
            THEN @both
        ELSE
            LTRIM(RTRIM(er.override_permissions))
            + CASE WHEN CHARINDEX(N'dgs_truck_inventory:', ISNULL(er.override_permissions, N'')) > 0
                   THEN N'' ELSE N', dgs_truck_inventory: READ_ONLY' END
            + CASE WHEN CHARINDEX(N'dgs_parts_inventory:', ISNULL(er.override_permissions, N'')) > 0
                   THEN N'' ELSE N', dgs_parts_inventory: READ_ONLY' END
    END,
    er.update_date = GETDATE(),
    er.update_by = N'dgs_truck_parts_inventory seed'
FROM employees.employee_roles AS er
WHERE er.reference_key IN (N'EMP-000040', N'EMP-000075', N'EMP-000068')
   OR LOWER(LTRIM(RTRIM(er.email))) IN (
        N'paulc@dynamicgamingsolutions.com',
        N'kevinperchalski@dynamicgamingsolutions.com',
        N'barryd@dynamicgamingsolutions.com'
      );
GO

/* Refresh combined_permissions for office seed + all Technicians */
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
   OR LOWER(LTRIM(RTRIM(er.email))) IN (
        N'paulc@dynamicgamingsolutions.com',
        N'kevinperchalski@dynamicgamingsolutions.com',
        N'barryd@dynamicgamingsolutions.com'
      )
   OR r.reference_key = N'RT-030'
   OR r.role = N'Technician'
   OR r.reference_key IN (N'RT-018', N'RT-016', N'RT-021', N'RT-031', N'RT-032');
GO

SELECT
    reference_key,
    name,
    email,
    CASE WHEN CHARINDEX(N'dgs_truck_inventory:', ISNULL(override_permissions, N'') + N',' + ISNULL(combined_permissions, N'')) > 0 THEN 1 ELSE 0 END AS has_truck,
    CASE WHEN CHARINDEX(N'dgs_parts_inventory:', ISNULL(override_permissions, N'') + N',' + ISNULL(combined_permissions, N'')) > 0 THEN 1 ELSE 0 END AS has_parts
FROM employees.employee_roles
WHERE reference_key IN (N'EMP-000040', N'EMP-000075', N'EMP-000068')
   OR LOWER(LTRIM(RTRIM(email))) IN (
        N'paulc@dynamicgamingsolutions.com',
        N'kevinperchalski@dynamicgamingsolutions.com',
        N'barryd@dynamicgamingsolutions.com'
      );

SELECT reference_key, role,
    CASE WHEN CHARINDEX(N'dgs_truck_inventory:', ISNULL(permissions, N'')) > 0 THEN 1 ELSE 0 END AS has_truck,
    CASE WHEN CHARINDEX(N'dgs_parts_inventory:', ISNULL(permissions, N'')) > 0 THEN 1 ELSE 0 END AS has_parts
FROM employees.roles
WHERE reference_key IN (N'RT-030', N'RT-031', N'RT-018', N'RT-016', N'RT-021', N'RT-032');
GO
