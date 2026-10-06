/*
  Dev view (dgs_view_as) — Paul only.

  Lets one signed-in person preview another active employee's permission map.
  Not in the Employees admin catalog, so it cannot be granted from that screen.
  Idempotent. Re-login after apply (JWT caches permissions ~12h).
*/
USE [dgs_application_db];
GO

DECLARE @token NVARCHAR(80) = N'dgs_view_as: READ_ONLY';
DECLARE @blob NVARCHAR(MAX);

SELECT @blob = override_permissions
FROM employees.employee_roles
WHERE reference_key = N'EMP-000040'
   OR LOWER(LTRIM(RTRIM(email))) = N'paulc@dynamicgamingsolutions.com';

IF @blob IS NULL OR CHARINDEX(N'dgs_view_as:', ISNULL(@blob, N'')) = 0
BEGIN
    UPDATE employees.employee_roles
    SET
        override_permissions = CASE
            WHEN override_permissions IS NULL OR LTRIM(RTRIM(override_permissions)) = N''
                THEN @token
            ELSE LTRIM(RTRIM(override_permissions)) + N', ' + @token
        END,
        update_date = GETDATE(),
        update_by = N'dgs_view_as seed'
    WHERE reference_key = N'EMP-000040'
       OR LOWER(LTRIM(RTRIM(email))) = N'paulc@dynamicgamingsolutions.com';
END
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
    er.update_by = N'dgs_view_as seed'
FROM employees.employee_roles er
LEFT JOIN employees.roles r ON r.reference_key = er.role_id
WHERE er.reference_key = N'EMP-000040'
   OR LOWER(LTRIM(RTRIM(er.email))) = N'paulc@dynamicgamingsolutions.com';
GO

SELECT reference_key, name, email,
       CASE WHEN CHARINDEX(N'dgs_view_as:', ISNULL(override_permissions, N'')) > 0 THEN 1 ELSE 0 END AS has_view_as
FROM employees.employee_roles
WHERE reference_key = N'EMP-000040'
   OR LOWER(LTRIM(RTRIM(email))) = N'paulc@dynamicgamingsolutions.com';
GO
