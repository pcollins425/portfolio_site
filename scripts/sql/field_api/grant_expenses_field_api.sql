-- Expenses browse API — SELECT grants for field API principals.
-- Run on dgs_application_db (privileged login via scripts/run_sql_file.py).
-- Idempotent. Grants each principal only if it exists in the database.

USE [dgs_application_db];
GO

DECLARE @targets TABLE (name SYSNAME NOT NULL);
INSERT INTO @targets (name)
SELECT name
FROM sys.database_principals
WHERE name IN (N'dgs_field_api', N'dashboard_perf_ro');

IF NOT EXISTS (SELECT 1 FROM @targets)
BEGIN
    RAISERROR(
        N'Neither dgs_field_api nor dashboard_perf_ro exists — run setup_field_api_login.sql or setup_dashboard_perf_reader.sql first.',
        16,
        1
    );
    RETURN;
END;

DECLARE @principal SYSNAME;
DECLARE target_cursor CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM @targets;
OPEN target_cursor;
FETCH NEXT FROM target_cursor INTO @principal;

WHILE @@FETCH_STATUS = 0
BEGIN
    DECLARE @sql NVARCHAR(MAX);

    SET @sql = N'GRANT SELECT ON OBJECT::[finance].[expenses] TO [' + REPLACE(@principal, N']', N']]') + N'];';
    EXEC sp_executesql @sql;

    SET @sql = N'GRANT SELECT ON OBJECT::[finance].[card_accounts] TO [' + REPLACE(@principal, N']', N']]') + N'];';
    EXEC sp_executesql @sql;

    SET @sql = N'GRANT SELECT ON OBJECT::[finance].[expense_account_gl_display] TO [' + REPLACE(@principal, N']', N']]') + N'];';
    EXEC sp_executesql @sql;

    SET @sql = N'GRANT SELECT ON OBJECT::[employees].[employee_roles] TO [' + REPLACE(@principal, N']', N']]') + N'];';
    EXEC sp_executesql @sql;

    PRINT N'Granted expenses browse SELECT to ' + @principal + N'.';

    FETCH NEXT FROM target_cursor INTO @principal;
END;

CLOSE target_cursor;
DEALLOCATE target_cursor;
GO
