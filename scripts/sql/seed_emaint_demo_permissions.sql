/*
  eMaint demo — per-table permission areas (INSERT only; no deletes).

  Adds role RT-032 (template) and appends demo grants to Paul Collins + Barry Downer
  via override_permissions only (does not change role_id).
*/
USE [dgs_application_db];
GO

IF NOT EXISTS (SELECT 1 FROM [employees].[roles] WHERE [reference_key] = N'RT-032')
BEGIN
    INSERT INTO [employees].[roles] (
        [uuid],
        [reference_key],
        [insert_date],
        [update_date],
        [update_by],
        [change_log],
        [role],
        [permissions]
    )
    VALUES (
        NEWID(),
        N'RT-032',
        GETDATE(),
        GETDATE(),
        N'eMaint demo seed',
        N'Added for portfolio eMaint demo auth (read-only browse + inventory edit).',
        N'eMaint Demo (beta)',
        N'emaint_demo_projects: READ_ONLY , emaint_demo_work_orders: READ_ONLY , emaint_demo_field_techs: READ_ONLY , emaint_demo_compinfo: UPDATES_ONLY , emaint_demo_inventory: ADDS_AND_UPDATES , emaint_demo_purchase_orders: READ_ONLY'
    );
END
GO

UPDATE [employees].[employee_roles]
SET
    [override_permissions] = CASE
        WHEN [override_permissions] IS NULL OR LTRIM(RTRIM([override_permissions])) = N''
            THEN N'emaint_demo_projects: READ_ONLY , emaint_demo_work_orders: READ_ONLY , emaint_demo_field_techs: READ_ONLY , emaint_demo_compinfo: UPDATES_ONLY , emaint_demo_inventory: ADDS_AND_UPDATES , emaint_demo_purchase_orders: READ_ONLY'
        WHEN [override_permissions] NOT LIKE N'%emaint_demo_projects:%'
            THEN LTRIM(RTRIM([override_permissions])) + N' , emaint_demo_projects: READ_ONLY , emaint_demo_work_orders: READ_ONLY , emaint_demo_field_techs: READ_ONLY , emaint_demo_compinfo: UPDATES_ONLY , emaint_demo_inventory: ADDS_AND_UPDATES , emaint_demo_purchase_orders: READ_ONLY'
        ELSE [override_permissions]
    END,
    [update_date] = GETDATE(),
    [update_by] = N'eMaint demo seed'
WHERE [reference_key] = N'EMP-000040';
GO

UPDATE [employees].[employee_roles]
SET
    [override_permissions] = CASE
        WHEN [override_permissions] IS NULL OR LTRIM(RTRIM([override_permissions])) = N''
            THEN N'emaint_demo_projects: READ_ONLY , emaint_demo_work_orders: READ_ONLY , emaint_demo_field_techs: READ_ONLY , emaint_demo_compinfo: UPDATES_ONLY , emaint_demo_inventory: ADDS_AND_UPDATES , emaint_demo_purchase_orders: READ_ONLY'
        WHEN [override_permissions] NOT LIKE N'%emaint_demo_projects:%'
            THEN LTRIM(RTRIM([override_permissions])) + N' , emaint_demo_projects: READ_ONLY , emaint_demo_work_orders: READ_ONLY , emaint_demo_field_techs: READ_ONLY , emaint_demo_compinfo: UPDATES_ONLY , emaint_demo_inventory: ADDS_AND_UPDATES , emaint_demo_purchase_orders: READ_ONLY'
        ELSE [override_permissions]
    END,
    [update_date] = GETDATE(),
    [update_by] = N'eMaint demo seed'
WHERE [reference_key] = N'EMP-000068';
GO
