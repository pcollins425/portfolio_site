/*
  dgs_part_requests — Build A pilot write for part requests on existing WOs.

  Paul (EMP-000040) + Kevin Perchalski (EMP-000075) only.
  Level ADDS_AND_UPDATES (counts as write in permission_catalog.has_area_write).
  Not granted on Technician / Org Browse roles.
  Idempotent. Re-login after apply (JWT caches permissions).
*/
USE [dgs_application_db];
GO

DECLARE @token NVARCHAR(80) = N'dgs_part_requests: ADDS_AND_UPDATES';

UPDATE er
SET
    er.override_permissions = CASE
        WHEN CHARINDEX(N'dgs_part_requests:', ISNULL(er.override_permissions, N'')) > 0
            THEN er.override_permissions
        WHEN er.override_permissions IS NULL OR LTRIM(RTRIM(er.override_permissions)) = N''
            THEN @token
        ELSE LTRIM(RTRIM(er.override_permissions)) + N', ' + @token
    END,
    er.update_date = GETDATE(),
    er.update_by = N'dgs_part_requests seed'
FROM employees.employee_roles AS er
WHERE er.reference_key IN (N'EMP-000040', N'EMP-000075')
   OR LOWER(LTRIM(RTRIM(er.email))) IN (
        N'paulc@dynamicgamingsolutions.com',
        N'kevinperchalski@dynamicgamingsolutions.com'
      );
GO

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
    er.update_by = N'dgs_part_requests seed'
FROM employees.employee_roles AS er
LEFT JOIN employees.roles AS r ON r.reference_key = er.role_id
WHERE er.reference_key IN (N'EMP-000040', N'EMP-000075')
   OR LOWER(LTRIM(RTRIM(er.email))) IN (
        N'paulc@dynamicgamingsolutions.com',
        N'kevinperchalski@dynamicgamingsolutions.com'
      );
GO

SELECT
    reference_key,
    name,
    email,
    CASE
        WHEN CHARINDEX(N'dgs_part_requests:', ISNULL(override_permissions, N'')) > 0
            THEN 1
        ELSE 0
    END AS has_part_requests
FROM employees.employee_roles
WHERE reference_key IN (N'EMP-000040', N'EMP-000075')
   OR LOWER(LTRIM(RTRIM(email))) IN (
        N'paulc@dynamicgamingsolutions.com',
        N'kevinperchalski@dynamicgamingsolutions.com'
      );
GO
