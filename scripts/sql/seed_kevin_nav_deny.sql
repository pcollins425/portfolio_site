/*
  Kevin P (EMP-000075) — remove nav areas via override NONE:
  Executive / Market / Performance (dgs_performance),
  Contracts, Deals, Software Vault, Employees (+ roles).

  Idempotent. Kevin must re-login after apply (JWT caches permissions).
*/
USE [dgs_application_db];
GO

DECLARE @emp NVARCHAR(25) = N'EMP-000075';
DECLARE @deny NVARCHAR(400) = N'dgs_performance: NONE, dgs_contracts: NONE, dgs_deals: NONE, dgs_software_vault: NONE, employees: NONE, roles: NONE';

UPDATE er
SET
    er.override_permissions = CASE
        WHEN er.override_permissions IS NULL OR LTRIM(RTRIM(er.override_permissions)) = N''
            THEN @deny
        ELSE
            /* Strip prior positive grants for these areas, then append NONE tokens. */
            LTRIM(RTRIM(er.override_permissions))
            + CASE WHEN CHARINDEX(N'dgs_performance:', ISNULL(er.override_permissions, N'')) > 0 THEN N'' ELSE N', dgs_performance: NONE' END
            + CASE WHEN CHARINDEX(N'dgs_contracts:', ISNULL(er.override_permissions, N'')) > 0 THEN N'' ELSE N', dgs_contracts: NONE' END
            + CASE WHEN CHARINDEX(N'dgs_deals:', ISNULL(er.override_permissions, N'')) > 0 THEN N'' ELSE N', dgs_deals: NONE' END
            + CASE WHEN CHARINDEX(N'dgs_software_vault:', ISNULL(er.override_permissions, N'')) > 0 THEN N'' ELSE N', dgs_software_vault: NONE' END
            + CASE WHEN CHARINDEX(N'employees:', ISNULL(er.override_permissions, N'')) > 0 THEN N'' ELSE N', employees: NONE' END
            + CASE WHEN CHARINDEX(N'roles:', ISNULL(er.override_permissions, N'')) > 0 THEN N'' ELSE N', roles: NONE' END
    END,
    er.update_date = GETDATE(),
    er.update_by = N'kevin_nav_deny'
FROM employees.employee_roles AS er
WHERE er.reference_key = @emp
   OR LOWER(LTRIM(RTRIM(er.email))) = N'kevinperchalski@dynamicgamingsolutions.com';
GO

/* Prefer the Python applier — it replaces employees/roles READ_ONLY with NONE cleanly. */
