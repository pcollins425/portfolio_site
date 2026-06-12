/*
  DGS Application — full module access group (2026-06-12).

  Members: Paul C, Barry D, Haley H, Garrett A, Travis J
  Policy: all app modules visible; READ_ONLY on most areas.
  Ops writes (compinfo, inventory) + Slot Master edits: Paul & Barry only.

  Appends missing emaint_demo_* / slot_master overrides without removing existing grants.
  Re-login after apply.
*/
USE [dgs_application_db];
GO

DECLARE @ops_read NVARCHAR(400) = N'emaint_demo_projects: READ_ONLY , emaint_demo_work_orders: READ_ONLY , emaint_demo_field_techs: READ_ONLY , emaint_demo_compinfo: READ_ONLY , emaint_demo_inventory: READ_ONLY , emaint_demo_purchase_orders: READ_ONLY';
DECLARE @slot_read NVARCHAR(40) = N'slot_master: READ_ONLY';
DECLARE @slot_write NVARCHAR(40) = N'slot_master: UPDATES_ONLY';

/* --- Executives: ops read-only + slot master read-only --- */
UPDATE [employees].[employee_roles]
SET
    [override_permissions] = CASE
        WHEN [override_permissions] IS NULL OR LTRIM(RTRIM([override_permissions])) = N'' THEN @ops_read + N' , ' + @slot_read
        WHEN [override_permissions] NOT LIKE N'%emaint_demo_projects:%' THEN LTRIM(RTRIM([override_permissions])) + N' , ' + @ops_read
        ELSE [override_permissions]
    END,
    [update_date] = GETDATE(),
    [update_by] = N'DGS app full access group'
WHERE [reference_key] IN (N'EMP-000055', N'EMP-000051', N'EMP-000042')
  AND [active] = 1;
GO

UPDATE [employees].[employee_roles]
SET
    [override_permissions] = CASE
        WHEN [override_permissions] NOT LIKE N'%slot_master:%' THEN LTRIM(RTRIM([override_permissions])) + N' , ' + @slot_read
        WHEN [override_permissions] LIKE N'%slot_master: ADDS_AND_UPDATES%' THEN REPLACE([override_permissions], N'slot_master: ADDS_AND_UPDATES', N'slot_master: READ_ONLY')
        WHEN [override_permissions] LIKE N'%slot_master: UPDATES_ONLY%' THEN REPLACE([override_permissions], N'slot_master: UPDATES_ONLY', N'slot_master: READ_ONLY')
        ELSE [override_permissions]
    END,
    [update_date] = GETDATE(),
    [update_by] = N'DGS app full access group'
WHERE [reference_key] IN (N'EMP-000055', N'EMP-000051', N'EMP-000042')
  AND [active] = 1;
GO

/* --- Paul & Barry: ensure all ops tabs + slot master edit --- */
UPDATE [employees].[employee_roles]
SET
    [override_permissions] = CASE
        WHEN [override_permissions] IS NULL OR LTRIM(RTRIM([override_permissions])) = N'' THEN @ops_read
        WHEN [override_permissions] NOT LIKE N'%emaint_demo_field_techs:%'
            THEN LTRIM(RTRIM([override_permissions])) + N' , emaint_demo_field_techs: READ_ONLY'
        ELSE [override_permissions]
    END,
    [update_date] = GETDATE(),
    [update_by] = N'DGS app full access group'
WHERE [reference_key] IN (N'EMP-000040', N'EMP-000068')
  AND [active] = 1;
GO

UPDATE [employees].[employee_roles]
SET
    [override_permissions] = CASE
        WHEN [override_permissions] NOT LIKE N'%slot_master:%' THEN LTRIM(RTRIM([override_permissions])) + N' , ' + @slot_write
        WHEN [override_permissions] LIKE N'%slot_master: ADDS_AND_UPDATES%' THEN REPLACE([override_permissions], N'slot_master: ADDS_AND_UPDATES', N'slot_master: UPDATES_ONLY')
        WHEN [override_permissions] LIKE N'%slot_master:%UPDATES_ONLY%' AND [override_permissions] NOT LIKE N'%slot_master: UPDATES_ONLY%' THEN REPLACE([override_permissions], N'slot_master:UPDATES_ONLY', N'slot_master: UPDATES_ONLY')
        ELSE [override_permissions]
    END,
    [update_date] = GETDATE(),
    [update_by] = N'DGS app full access group'
WHERE [reference_key] IN (N'EMP-000040', N'EMP-000068')
  AND [active] = 1;
GO

PRINT N'DGS app full access group: EMP-000040, EMP-000068 (ops + slot edit), EMP-000055/051/042 (ops + slot read-only).';
GO
