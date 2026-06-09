/*
  Slot Master UI — JWT permission area (employees.employee_roles).

  Adds slot_master:UPDATES_ONLY to Paul Collins override (EMP-000040).
  Re-login after apply to refresh JWT permissions blob.
*/
USE [dgs_application_db];
GO

UPDATE [employees].[employee_roles]
SET
    [override_permissions] = CASE
        WHEN [override_permissions] IS NULL OR LTRIM(RTRIM([override_permissions])) = N''
            THEN N'slot_master:UPDATES_ONLY'
        WHEN [override_permissions] NOT LIKE N'%slot_master:%'
            THEN LTRIM(RTRIM([override_permissions])) + N' , slot_master:UPDATES_ONLY'
        ELSE [override_permissions]
    END,
    [update_date] = GETDATE(),
    [update_by] = N'Slot Master seed'
WHERE [reference_key] = N'EMP-000040';
GO

PRINT N'Appended slot_master:UPDATES_ONLY to EMP-000040 override_permissions (if missing).';
GO
