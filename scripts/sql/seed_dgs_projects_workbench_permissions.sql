/*
  DGS Project Workbench permissions (2026-09-25).

  Area: dgs_projects_workbench
    READ_ONLY     — list + detail
    UPDATES_ONLY+ — draft edits, Pre-Check status, draft↔pre_check stage

  Policy:
    - Anyone with dgs_projects_calendar gets READ_ONLY (if not already granted)
    - Paul / Barry / Travis / Matt get UPDATES_ONLY for write
*/
USE [dgs_application_db];
GO

DECLARE @wb_read NVARCHAR(80) = N'dgs_projects_workbench: READ_ONLY';

UPDATE er
SET
    er.[override_permissions] = CASE
        WHEN er.[override_permissions] IS NULL OR LTRIM(RTRIM(er.[override_permissions])) = N''
            THEN @wb_read
        ELSE LTRIM(RTRIM(er.[override_permissions])) + N' , ' + @wb_read
    END,
    er.[update_date] = GETDATE(),
    er.[update_by] = N'DGS Project Workbench seed'
FROM [employees].[employee_roles] er
LEFT JOIN [employees].[roles] r ON r.[reference_key] = er.[role_id]
WHERE er.[active] = 1
  AND (
        er.[override_permissions] LIKE N'%dgs_projects_calendar:%'
     OR r.[permissions] LIKE N'%dgs_projects_calendar:%'
     OR er.[override_permissions] LIKE N'%emaint_demo_projects:%'
     OR r.[permissions] LIKE N'%emaint_demo_projects:%'
  )
  AND (
        er.[override_permissions] IS NULL
     OR er.[override_permissions] NOT LIKE N'%dgs_projects_workbench:%'
  );
GO

DECLARE @wb_write NVARCHAR(80) = N'dgs_projects_workbench: UPDATES_ONLY';

UPDATE er
SET
    er.[override_permissions] = CASE
        WHEN er.[override_permissions] LIKE N'%dgs_projects_workbench: READ_ONLY%'
            THEN REPLACE(er.[override_permissions], N'dgs_projects_workbench: READ_ONLY', @wb_write)
        WHEN er.[override_permissions] LIKE N'%dgs_projects_workbench:%'
            THEN er.[override_permissions]
        WHEN er.[override_permissions] IS NULL OR LTRIM(RTRIM(er.[override_permissions])) = N''
            THEN @wb_write
        ELSE LTRIM(RTRIM(er.[override_permissions])) + N' , ' + @wb_write
    END,
    er.[update_date] = GETDATE(),
    er.[update_by] = N'DGS Project Workbench write seed'
FROM [employees].[employee_roles] er
WHERE er.[active] = 1
  AND (
        LOWER(er.[email]) IN (
            N'paulc@dynamicgamingsolutions.com',
            N'barryd@dynamicgamingsolutions.com',
            N'travisj@dynamicgamingsolutions.com',
            N'matthewh@dynamicgamingsolutions.com'
        )
        OR er.[reference_key] IN (N'EMP-000040', N'EMP-000068', N'EMP-000042', N'EMP-000100')
      );
GO

SELECT er.[reference_key], er.[name], er.[email], er.[override_permissions]
FROM [employees].[employee_roles] er
WHERE er.[override_permissions] LIKE N'%dgs_projects_workbench:%';
GO

PRINT N'DGS Project Workbench permissions seeded.';
GO
