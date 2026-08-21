-- Dashboard RO: commission contract queue needs SMM commission_profile_id.
-- Run on dgs_application_db with a privileged login (not dashboard_perf_ro).
-- Idempotent.

USE [dgs_application_db];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'dashboard_perf_ro')
BEGIN
    RAISERROR(N'dashboard_perf_ro user missing — run setup_dashboard_perf_reader.sql first.', 16, 1);
    RETURN;
END;
GO

-- Minimal read for commission A↔B check (profile key on migration rows).
GRANT SELECT ON OBJECT::[inventory].[slot_master_migration] TO [dashboard_perf_ro];
GO

PRINT N'Granted SELECT on inventory.slot_master_migration to dashboard_perf_ro.';
GO
