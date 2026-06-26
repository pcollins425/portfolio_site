-- Field API (dgs_field_api): read access for Commerce browse (Casinos, Vendors).
-- Run on dgs_application_db after clients.casino_view exists.
-- Idempotent.

USE [dgs_application_db];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'dgs_field_api')
BEGIN
    RAISERROR(N'dgs_field_api user missing — run setup_field_api_login.sql first.', 16, 1);
    RETURN;
END;
GO

GRANT SELECT ON OBJECT::[clients].[casino_view] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[dashboard].[vw_performance_report] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[projects].[ims] TO [dgs_field_api];
GO

PRINT N'Granted SELECT on clients.casino_view, dashboard.vw_performance_report, and projects.ims to dgs_field_api.';
GO

-- vw_performance_report reads [DGS_SLOT].[dbo].[Master_Revenue]; field API needs same cross-db access.
USE [DGS_SLOT];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'dgs_field_api')
    CREATE USER [dgs_field_api] FOR LOGIN [dgs_field_api];
GO

GRANT CONNECT TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[dbo].[Master_Revenue] TO [dgs_field_api];
GO

PRINT N'Granted CONNECT + SELECT on DGS_SLOT.dbo.Master_Revenue to dgs_field_api.';
GO
