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

GRANT SELECT ON OBJECT::[projects].[ims] TO [dgs_field_api];
GO

PRINT N'Granted SELECT on clients.casino_view and projects.ims to dgs_field_api.';
GO
