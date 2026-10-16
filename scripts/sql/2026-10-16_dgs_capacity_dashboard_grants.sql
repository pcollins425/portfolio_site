/*
  Dashboard · Capacity — Ops / Finance management only.
  Never grant on Technician (RT-030).
  Seed READ_ONLY onto roles that already hold Finance billing or Performance,
  plus Paul's employee override.
*/
DECLARE @token nvarchar(80) = N'dgs_capacity_dashboard: READ_ONLY';

UPDATE employees.roles
SET permissions = CASE
      WHEN NULLIF(LTRIM(RTRIM(permissions)), N'') IS NULL THEN @token
      ELSE RTRIM(permissions) + N', ' + @token
    END,
    update_date = GETDATE(),
    update_by = N'dgs capacity dashboard'
WHERE reference_key <> N'RT-030'
  AND (
        CHARINDEX(N'dgs_finance_dashboard:', ISNULL(permissions, N'')) > 0
     OR CHARINDEX(N'dgs_performance:', ISNULL(permissions, N'')) > 0
      )
  AND CHARINDEX(N'dgs_capacity_dashboard:', ISNULL(permissions, N'')) = 0;

UPDATE employees.employee_roles
SET override_permissions = CASE
      WHEN NULLIF(LTRIM(RTRIM(override_permissions)), N'') IS NULL THEN @token
      ELSE RTRIM(override_permissions) + N', ' + @token
    END,
    update_date = GETDATE(),
    update_by = N'dgs capacity dashboard'
WHERE reference_key = N'EMP-000040'
  AND CHARINDEX(N'dgs_capacity_dashboard:', ISNULL(override_permissions, N'')) = 0;

/* Field API already reads work_orders / casinos / assets. Confirm material. */
IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'dgs_field_api')
BEGIN
    IF OBJECT_ID(N'projects.work_order_material', N'U') IS NOT NULL
        GRANT SELECT ON OBJECT::projects.work_order_material TO dgs_field_api;
    IF OBJECT_ID(N'clients.states', N'U') IS NOT NULL
        GRANT SELECT ON OBJECT::clients.states TO dgs_field_api;
    IF OBJECT_ID(N'vendors.themes', N'U') IS NOT NULL
        GRANT SELECT ON OBJECT::vendors.themes TO dgs_field_api;
    PRINT N'Capacity dashboard SELECT grants for dgs_field_api.';
END
ELSE
    PRINT N'dgs_field_api not found — skip object grants.';
