/*
  Work Orders module — techs + office (READ_ONLY).
  Seed onto every role that already has Projects Calendar, plus Technician,
  plus Paul's employee override.
*/
DECLARE @token nvarchar(80) = N'dgs_work_orders: READ_ONLY';

UPDATE employees.roles
SET permissions = CASE
      WHEN NULLIF(LTRIM(RTRIM(permissions)), N'') IS NULL THEN @token
      ELSE RTRIM(permissions) + N', ' + @token
    END,
    update_date = GETDATE(),
    update_by = N'dgs work orders'
WHERE (
        reference_key = N'RT-030'
     OR CHARINDEX(N'dgs_projects_calendar:', ISNULL(permissions, N'')) > 0
     OR CHARINDEX(N'dgs_tech_dashboard:', ISNULL(permissions, N'')) > 0
     OR CHARINDEX(N'dgs_capacity_dashboard:', ISNULL(permissions, N'')) > 0
      )
  AND CHARINDEX(N'dgs_work_orders:', ISNULL(permissions, N'')) = 0;

UPDATE employees.employee_roles
SET override_permissions = CASE
      WHEN NULLIF(LTRIM(RTRIM(override_permissions)), N'') IS NULL THEN @token
      ELSE RTRIM(override_permissions) + N', ' + @token
    END,
    update_date = GETDATE(),
    update_by = N'dgs work orders'
WHERE reference_key = N'EMP-000040'
  AND CHARINDEX(N'dgs_work_orders:', ISNULL(override_permissions, N'')) = 0;

PRINT N'dgs_work_orders grants applied.';
GO
