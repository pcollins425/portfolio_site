/*
  DGS Projects module — read-only view grants (2026-07-09).

  New permission areas (backend_live/app/dgs_projects_permissions.py):
    - dgs_projects_calendar: READ_ONLY   (projects.ims month calendar)
    - dgs_projects_catalog:  READ_ONLY   (projects.project_catalog + printout)
  The eMaint tab keeps using emaint_demo_projects — no new grant needed.

  Policy: everyone who can already read the Operations eMaint projects grid
  (emaint_demo_projects in role or override permissions) gets both new areas.
  Appends only — nothing is removed. Re-login after apply so the JWT refreshes.
*/
USE [dgs_application_db];
GO

DECLARE @projects_read NVARCHAR(120) =
    N'dgs_projects_calendar: READ_ONLY , dgs_projects_catalog: READ_ONLY';

UPDATE er
SET
    er.[override_permissions] = CASE
        WHEN er.[override_permissions] IS NULL OR LTRIM(RTRIM(er.[override_permissions])) = N''
            THEN @projects_read
        ELSE LTRIM(RTRIM(er.[override_permissions])) + N' , ' + @projects_read
    END,
    er.[update_date] = GETDATE(),
    er.[update_by] = N'DGS Projects module seed'
FROM [employees].[employee_roles] er
LEFT JOIN [employees].[roles] r ON r.[reference_key] = er.[role_id]
WHERE er.[active] = 1
  AND (er.[override_permissions] LIKE N'%emaint_demo_projects:%'
       OR r.[permissions] LIKE N'%emaint_demo_projects:%')
  AND (er.[override_permissions] IS NULL
       OR er.[override_permissions] NOT LIKE N'%dgs_projects_calendar:%');
GO

SELECT er.[reference_key], er.[name], er.[override_permissions]
FROM [employees].[employee_roles] er
WHERE er.[active] = 1
  AND er.[override_permissions] LIKE N'%dgs_projects_calendar:%';
GO

PRINT N'DGS Projects grants appended (calendar + catalog READ_ONLY) for existing ops-projects users.';
GO
