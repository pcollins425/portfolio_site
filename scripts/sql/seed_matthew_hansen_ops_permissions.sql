/*
  Matthew Hansen — full Operations (eMaint) web access (Option B).

  Matches Paul/Barry ops write pattern from seed_emaint_demo_permissions.sql.
  Re-login after apply so JWT includes Operations table list.
*/
USE [dgs_application_db];
GO

DECLARE @ops_write NVARCHAR(500) = N'emaint_demo_projects: READ_ONLY , emaint_demo_work_orders: READ_ONLY , emaint_demo_field_techs: READ_ONLY , emaint_demo_compinfo: UPDATES_ONLY , emaint_demo_inventory: ADDS_AND_UPDATES , emaint_demo_purchase_orders: READ_ONLY';

UPDATE [employees].[employee_roles]
SET
    [override_permissions] = CASE
        WHEN [override_permissions] IS NULL OR LTRIM(RTRIM([override_permissions])) = N''
            THEN @ops_write
        WHEN [override_permissions] NOT LIKE N'%emaint_demo_projects:%'
            THEN LTRIM(RTRIM([override_permissions])) + N' , ' + @ops_write
        ELSE [override_permissions]
    END,
    [update_date] = GETDATE(),
    [update_by] = N'Matthew Hansen onboarding (Option B)'
WHERE [reference_key] = N'EMP-000100'
  AND [email] = N'matthewh@dynamicgamingsolutions.com'
  AND [active] = 1;
GO

PRINT N'Applied Option B emaint_demo_* grants to EMP-000100 (Matthew Hansen).';
GO
