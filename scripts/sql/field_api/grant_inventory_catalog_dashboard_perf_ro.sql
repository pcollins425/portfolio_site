-- Local dev: dashboard_perf_ro needs catalog read for WO material / assignable qty APIs.
USE [dgs_application_db];
GO

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'dashboard_perf_ro')
BEGIN
    GRANT SELECT ON OBJECT::[inventory].[inventory] TO [dashboard_perf_ro];
    PRINT N'Granted SELECT on inventory.inventory to dashboard_perf_ro.';
END
GO
