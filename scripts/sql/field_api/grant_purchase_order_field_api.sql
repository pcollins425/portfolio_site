-- Field API (dgs_field_api): read access for Purchase Orders demo.
-- Run on dgs_application_db after inventory.purchase_order* tables exist.
-- Idempotent.

USE [dgs_application_db];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'dgs_field_api')
BEGIN
    RAISERROR(N'dgs_field_api user missing — run setup_field_api_login.sql first.', 16, 1);
    RETURN;
END;
GO

GRANT SELECT ON OBJECT::[inventory].[purchase_order] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[inventory].[purchase_order_line] TO [dgs_field_api];
GO

PRINT N'Granted SELECT on inventory.purchase_order and purchase_order_line to dgs_field_api.';
GO
