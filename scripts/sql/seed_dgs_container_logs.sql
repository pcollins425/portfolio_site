/*
  Container logs (dgs_container_logs) — Paul only to start.

  Read-only page grant. Further people are added in Employees admin.
  Idempotent. Re-login after apply (the JWT caches permissions for about 12h).
*/
USE [dgs_application_db];
GO

DECLARE @token NVARCHAR(80) = N'dgs_container_logs: READ_ONLY';

UPDATE employees.employee_roles
SET
    override_permissions = CASE
        WHEN override_permissions IS NULL OR LTRIM(RTRIM(override_permissions)) = N''
            THEN @token
        ELSE LTRIM(RTRIM(override_permissions)) + N', ' + @token
    END,
    update_date = GETDATE(),
    update_by = N'dgs_container_logs seed'
WHERE (
        reference_key = N'EMP-000040'
        OR LOWER(LTRIM(RTRIM(email))) = N'paulc@dynamicgamingsolutions.com'
    )
  AND CHARINDEX(N'dgs_container_logs:', ISNULL(override_permissions, N'')) = 0;
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
    er.update_by = N'dgs_container_logs seed'
FROM employees.employee_roles er
LEFT JOIN employees.roles r ON r.reference_key = er.role_id
WHERE er.reference_key = N'EMP-000040'
   OR LOWER(LTRIM(RTRIM(er.email))) = N'paulc@dynamicgamingsolutions.com';
GO
