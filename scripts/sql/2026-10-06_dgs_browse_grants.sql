/*
  Performance, contracts, deals, and software vault used to be open to every
  signed-in employee. They are grants now. Every role except Technician
  keeps today's access. Technician stays without them, so an employee
  override can open one area.

  Workbench is already its own grant (dgs_projects_workbench) and is not added here.
*/
DECLARE @grant nvarchar(400) = N'dgs_performance: READ_ONLY, dgs_contracts: READ_ONLY, dgs_deals: READ_ONLY, dgs_software_vault: READ_ONLY';

UPDATE employees.roles
SET permissions = CASE
      WHEN NULLIF(LTRIM(RTRIM(permissions)), N'') IS NULL THEN @grant
      ELSE RTRIM(permissions) + N', ' + @grant
    END,
    update_date = GETDATE(),
    update_by = 'dgs browse grants'
WHERE reference_key <> N'RT-030'
  AND CHARINDEX(N'dgs_performance:', ISNULL(permissions, N'')) = 0;

/* Technician sees the schedule and catalog. Printout stays behind dgs_performance. */
UPDATE employees.roles
SET permissions = RTRIM(permissions) + N', dgs_projects_calendar: READ_ONLY, dgs_projects_catalog: READ_ONLY',
    update_date = GETDATE(),
    update_by = 'dgs browse grants'
WHERE reference_key = N'RT-030'
  AND CHARINDEX(N'dgs_projects_calendar:', ISNULL(permissions, N'')) = 0;

/* Field dashboard: techs see their own rows. Paul can see every row and grant it. */
UPDATE employees.roles
SET permissions = RTRIM(permissions) + N', dgs_tech_dashboard: READ_ONLY',
    update_date = GETDATE(),
    update_by = 'dgs browse grants'
WHERE reference_key = N'RT-030'
  AND CHARINDEX(N'dgs_tech_dashboard:', ISNULL(permissions, N'')) = 0;

UPDATE employees.employee_roles
SET override_permissions = RTRIM(override_permissions) + N', dgs_tech_dashboard: READ_ONLY',
    update_date = GETDATE(),
    update_by = 'dgs browse grants'
WHERE reference_key = N'EMP-000040'
  AND CHARINDEX(N'dgs_tech_dashboard:', ISNULL(override_permissions, N'')) = 0;
