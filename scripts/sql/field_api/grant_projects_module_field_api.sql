-- Field API (dgs_field_api): Projects module reads (dgsapp Calendar/Catalog/printout).
-- Run on dgs_application_db. Idempotent.
--
-- /api/projects/* uses profile=field (MSSQL_FIELD_USER, else MSSQL_USER fallback).
-- Grants each existing principal in (dgs_field_api, dashboard_perf_ro).
--
-- Re-run after any DROP/CREATE of projects.project_printout (e.g. sold printout
-- migration 2026-07-10) — SQL Server does not preserve view grants on recreate.

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
    DECLARE @q SYSNAME = REPLACE(@principal, N']', N']]');

    SET @sql = N'GRANT SELECT ON OBJECT::[projects].[project_catalog] TO [' + @q + N'];';
    EXEC sp_executesql @sql;

    SET @sql = N'GRANT SELECT ON OBJECT::[projects].[project_details] TO [' + @q + N'];';
    EXEC sp_executesql @sql;

    SET @sql = N'GRANT SELECT ON OBJECT::[projects].[project_status] TO [' + @q + N'];';
    EXEC sp_executesql @sql;

    SET @sql = N'GRANT SELECT ON OBJECT::[projects].[action_types] TO [' + @q + N'];';
    EXEC sp_executesql @sql;

    IF OBJECT_ID(N'projects.sold_details', N'U') IS NOT NULL
    BEGIN
        SET @sql = N'GRANT SELECT ON OBJECT::[projects].[sold_details] TO [' + @q + N'];';
        EXEC sp_executesql @sql;
    END;

    IF OBJECT_ID(N'projects.project_sold_printout', N'V') IS NOT NULL
    BEGIN
        SET @sql = N'GRANT SELECT ON OBJECT::[projects].[project_sold_printout] TO [' + @q + N'];';
        EXEC sp_executesql @sql;
    END;

    SET @sql = N'GRANT SELECT ON OBJECT::[projects].[project_printout] TO [' + @q + N'];';
    EXEC sp_executesql @sql;

    PRINT N'Granted projects module SELECT to ' + @principal + N'.';

    FETCH NEXT FROM target_cursor INTO @principal;
END;

CLOSE target_cursor;
DEALLOCATE target_cursor;
GO
