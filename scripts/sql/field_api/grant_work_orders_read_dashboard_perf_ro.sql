USE [dgs_application_db];
GO

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'dashboard_perf_ro')
BEGIN
    GRANT SELECT ON OBJECT::[projects].[work_orders] TO [dashboard_perf_ro];
    PRINT N'Granted SELECT on projects.work_orders to dashboard_perf_ro.';
END
GO
