-- Local dev: dashboard_perf_ro needs catalog read for parts shop + WO material APIs.
-- Parts catalog LEFT JOINs inventory.software to exclude software SKUs from the shop browse.
USE [dgs_application_db];
GO

IF EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'dashboard_perf_ro')
BEGIN
    GRANT SELECT ON OBJECT::[inventory].[inventory] TO [dashboard_perf_ro];
    GRANT SELECT ON OBJECT::[inventory].[software] TO [dashboard_perf_ro];
    PRINT N'Granted SELECT on inventory.inventory + inventory.software to dashboard_perf_ro.';
END
ELSE
    PRINT N'dashboard_perf_ro not found — skip.';
GO
