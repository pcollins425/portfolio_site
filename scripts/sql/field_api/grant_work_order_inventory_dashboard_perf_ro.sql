-- Optional: same WO inventory access for dashboard_perf_ro (local dev when MSSQL_FIELD_* unset).
USE [dgs_application_db];
GO

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'dashboard_perf_ro')
BEGIN
    GRANT SELECT, INSERT, UPDATE ON OBJECT::[inventory].[stock_balance] TO [dashboard_perf_ro];
    GRANT SELECT, INSERT ON OBJECT::[inventory].[stock_movement] TO [dashboard_perf_ro];
    GRANT SELECT, INSERT, UPDATE ON OBJECT::[projects].[work_order_material] TO [dashboard_perf_ro];
    PRINT N'Granted work order inventory tables to dashboard_perf_ro.';
END
GO
