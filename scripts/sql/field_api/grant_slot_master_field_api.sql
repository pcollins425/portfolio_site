-- Field API (dgs_field_api): Slot Master browse + attribute edits.
-- Run on dgs_application_db after inventory.slot_master_migration exists.
-- Idempotent.

USE [dgs_application_db];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'dgs_field_api')
BEGIN
    RAISERROR(N'dgs_field_api user missing — run setup_field_api_login.sql first.', 16, 1);
    RETURN;
END;
GO

GRANT SELECT ON OBJECT::[inventory].[slot_master_migration] TO [dgs_field_api];
GO

GRANT UPDATE ON OBJECT::[inventory].[slot_master_migration] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[clients].[states] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[clients].[tribes] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[clients].[casinos] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[inventory].[assets] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[vendors].[themes] TO [dgs_field_api];
GO

PRINT N'Granted SELECT/UPDATE on slot_master_migration and lookup tables to dgs_field_api.';
GO
