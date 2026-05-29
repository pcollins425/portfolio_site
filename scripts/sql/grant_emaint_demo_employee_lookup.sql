/*
  eMaint demo auth — allow dashboard API login (MSSQL_USER) to read employee directory.
  Run once with privileged login. Does not change AppSheet / field API grants.
*/
USE [dgs_application_db];
GO

/* Default: portfolio API login (backend_live MSSQL_USER). Override with sqlcmd -v EMAINT_DEMO_AUTH_DB_USER=... */
DECLARE @principal SYSNAME = NULLIF(LTRIM(RTRIM(N'$(EMAINT_DEMO_AUTH_DB_USER)')), N'');
IF @principal IS NULL
    SET @principal = N'dashboard_perf_ro';

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @principal)
BEGIN
    RAISERROR(N'Database user %s not found in dgs_application_db.', 16, 1, @principal);
    RETURN;
END

DECLARE @sql NVARCHAR(MAX) = N'GRANT SELECT ON [employees].[employee_roles] TO [' + REPLACE(@principal, N']', N']]') + N'];
GRANT SELECT ON [employees].[roles] TO [' + REPLACE(@principal, N']', N']]') + N'];';
EXEC sp_executesql @sql;
PRINT N'Granted employees lookup to ' + @principal;
GO
