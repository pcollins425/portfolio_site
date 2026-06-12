/*
  DGS Application — Operations read-only access for executive staff.

  Appends emaint_demo_* READ_ONLY areas via override_permissions (does not change role_id).
  Targets: Haley H (HR/Compliance), Garrett A (Finance), Travis J (Sales).

  Re-login after apply so JWT includes Operations table list.
*/
USE [dgs_application_db];
GO

DECLARE @ops_read NVARCHAR(400) = N'emaint_demo_projects: READ_ONLY , emaint_demo_work_orders: READ_ONLY , emaint_demo_field_techs: READ_ONLY , emaint_demo_compinfo: READ_ONLY , emaint_demo_inventory: READ_ONLY , emaint_demo_purchase_orders: READ_ONLY';

UPDATE [employees].[employee_roles]
SET
    [override_permissions] = CASE
        WHEN [override_permissions] IS NULL OR LTRIM(RTRIM([override_permissions])) = N''
            THEN @ops_read
        WHEN [override_permissions] NOT LIKE N'%emaint_demo_projects:%'
            THEN LTRIM(RTRIM([override_permissions])) + N' , ' + @ops_read
        ELSE [override_permissions]
    END,
    [update_date] = GETDATE(),
    [update_by] = N'DGS ops executive seed'
WHERE [reference_key] IN (N'EMP-000055', N'EMP-000051', N'EMP-000042')
  AND [active] = 1;
GO

PRINT N'Appended Operations READ_ONLY emaint_demo_* grants to EMP-000055 (Haley), EMP-000051 (Garrett), EMP-000042 (Travis J) when missing.';
GO
