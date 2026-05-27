/*
  Create least-privilege reader for Collins dashboard API.

  Replace BEFORE running:
    __REPLACE_UNDERLYING_OBJECT__  -> schema-qualified source (table or view), e.g. dbo.vw_my_performance
    __REPLACE_DASHBOARD_SQL_PASSWORD__ -> strong password for SQL Auth login dashboard_perf_ro

  Run with privileged login (same as **``scripts/run_sql_file.py``** in this repo). Batches split on GO.

  IMPORTANT: Never commit substituted passwords.
*/

USE master;

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'dashboard_perf_ro')
BEGIN
    CREATE LOGIN [dashboard_perf_ro]
    WITH
        PASSWORD = N'__REPLACE_DASHBOARD_SQL_PASSWORD__',
        DEFAULT_DATABASE = [dgs_application_db],
        CHECK_POLICY = ON,
        CHECK_EXPIRATION = OFF;
END
ELSE
BEGIN
    ALTER LOGIN [dashboard_perf_ro] WITH PASSWORD = N'__REPLACE_DASHBOARD_SQL_PASSWORD__';
END
GO

USE [dgs_application_db];

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'dashboard')
    EXEC (N'CREATE SCHEMA [dashboard] AUTHORIZATION [dbo]');
GO

IF EXISTS (
    SELECT 1
    FROM sys.database_principals
    WHERE name = N'dashboard_perf_ro'
)
    DROP USER [dashboard_perf_ro];
GO

CREATE USER [dashboard_perf_ro] FOR LOGIN [dashboard_perf_ro];
GO

/* Thin read-only façade over your real performance-report object */
CREATE OR ALTER VIEW [dashboard].[vw_performance_report]
AS
SELECT *
FROM __REPLACE_UNDERLYING_OBJECT__;
GO

GRANT SELECT ON OBJECT::[dashboard].[vw_performance_report] TO [dashboard_perf_ro];
GO
