-- Field API (dgs_field_api): contract PDF catalog + upload (Contracts v2).
-- Run on dgs_application_db after inventory.document exists.
-- Idempotent.

USE [dgs_application_db];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'dgs_field_api')
BEGIN
    RAISERROR(N'dgs_field_api user missing — run setup_field_api_login.sql first.', 16, 1);
    RETURN;
END;
GO

GRANT SELECT ON OBJECT::[inventory].[document] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[inventory].[contract_document] TO [dgs_field_api];
GO

GRANT INSERT, UPDATE ON OBJECT::[inventory].[document] TO [dgs_field_api];
GO

GRANT INSERT, UPDATE ON OBJECT::[inventory].[contract_document] TO [dgs_field_api];
GO

GRANT UPDATE ON OBJECT::[inventory].[contract] TO [dgs_field_api];
GO

PRINT N'Granted contract document + contract UPDATE to dgs_field_api.';
GO
