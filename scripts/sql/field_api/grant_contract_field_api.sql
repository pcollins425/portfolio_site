-- Field API (dgs_field_api): read access for vendor contracts UI.
-- Run on dgs_application_db after inventory.contract* tables exist.
-- Idempotent.

USE [dgs_application_db];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'dgs_field_api')
BEGIN
    RAISERROR(N'dgs_field_api user missing — run setup_field_api_login.sql first.', 16, 1);
    RETURN;
END;
GO

GRANT SELECT ON OBJECT::[inventory].[contract] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[inventory].[contract_line] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[inventory].[contract_line_serial] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[vendors].[vendors] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[vendors].[cabinets] TO [dgs_field_api];
GO

PRINT N'Granted SELECT on inventory.contract* and vendors lookup tables to dgs_field_api.';
GO
