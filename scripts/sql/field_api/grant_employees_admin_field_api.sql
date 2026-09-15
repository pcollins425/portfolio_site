/*
  Field API: SELECT + UPDATE on employees.roles / employee_roles for Admin UI.
  Run with privileged login on dgs_application_db.
*/
USE [dgs_application_db];
GO

DECLARE @principals TABLE (name SYSNAME);
INSERT INTO @principals (name)
SELECT p.name
FROM sys.database_principals p
WHERE p.name IN (N'dgs_field_api', N'dashboard_perf_ro');

IF NOT EXISTS (SELECT 1 FROM @principals)
BEGIN
    RAISERROR(N'Neither dgs_field_api nor dashboard_perf_ro exists.', 16, 1);
    RETURN;
END

DECLARE @name SYSNAME;
DECLARE c CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM @principals;
OPEN c;
FETCH NEXT FROM c INTO @name;
WHILE @@FETCH_STATUS = 0
BEGIN
    DECLARE @sql NVARCHAR(MAX) = N'
GRANT SELECT, UPDATE ON OBJECT::[employees].[employee_roles] TO [' + REPLACE(@name, N']', N']]') + N'];
GRANT SELECT, UPDATE ON OBJECT::[employees].[roles] TO [' + REPLACE(@name, N']', N']]') + N'];';
    EXEC sp_executesql @sql;
    PRINT N'Granted employees admin CRUD read/update to ' + @name;
    FETCH NEXT FROM c INTO @name;
END
CLOSE c;
DEALLOCATE c;
GO
