/*
  Dashboard API — SQL Authentication reader (PoC).

  LOGIN + USER NAME: dashboard_perf_ro
  PASSWORD: replace both occurrences of REPLACE_WITH_VAULT_PASSWORD (inside N'...')
            with your vault password before running. Do not commit the filled-in script.

  Prerequisite: view [dashboard].[vw_performance_report] must exist
                (create_vw_dashboard_from_slot_master_revenue.sql).

  If your main catalog is not [dgs_application_db], change the USE line in batch 2
  to match MSSQL_DATABASE in your .env.
*/

USE master;

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'dashboard_perf_ro')
BEGIN
    CREATE LOGIN [dashboard_perf_ro]
    WITH
        PASSWORD = N'REPLACE_WITH_VAULT_PASSWORD',
        DEFAULT_DATABASE = [dgs_application_db],
        CHECK_POLICY = ON,
        CHECK_EXPIRATION = OFF;
END
ELSE
BEGIN
    ALTER LOGIN [dashboard_perf_ro] WITH PASSWORD = N'REPLACE_WITH_VAULT_PASSWORD';
END
GO

USE [dgs_application_db];

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'dashboard_perf_ro')
    CREATE USER [dashboard_perf_ro] FOR LOGIN [dashboard_perf_ro];

GRANT SELECT ON OBJECT::[dashboard].[vw_performance_report] TO [dashboard_perf_ro];
GO
