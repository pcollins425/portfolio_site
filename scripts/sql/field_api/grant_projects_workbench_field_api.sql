/*
  Field API grants for Project Workbench proposal tables.
  Apply after 2026-09-25_projects_proposal_*.sql on dgs_application_db.
*/
USE [dgs_application_db];
GO

DECLARE @targets TABLE (name SYSNAME NOT NULL);
INSERT INTO @targets (name)
SELECT name
FROM sys.database_principals
WHERE name IN (N'dgs_field_api', N'dashboard_perf_ro');

DECLARE @principal SYSNAME;
DECLARE target_cursor CURSOR LOCAL FAST_FORWARD FOR SELECT name FROM @targets;
OPEN target_cursor;
FETCH NEXT FROM target_cursor INTO @principal;

WHILE @@FETCH_STATUS = 0
BEGIN
    DECLARE @sql NVARCHAR(MAX);
    DECLARE @q SYSNAME = REPLACE(@principal, N']', N']]');

    IF OBJECT_ID(N'projects.proposal', N'U') IS NOT NULL
    BEGIN
        SET @sql = N'GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[projects].[proposal] TO [' + @q + N'];';
        EXEC sp_executesql @sql;
    END
    IF OBJECT_ID(N'projects.proposal_unit', N'U') IS NOT NULL
    BEGIN
        SET @sql = N'GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[projects].[proposal_unit] TO [' + @q + N'];';
        EXEC sp_executesql @sql;
    END
    IF OBJECT_ID(N'projects.proposal_readiness_check', N'U') IS NOT NULL
    BEGIN
        SET @sql = N'GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[projects].[proposal_readiness_check] TO [' + @q + N'];';
        EXEC sp_executesql @sql;
    END
    IF OBJECT_ID(N'projects.proposal_artifact', N'U') IS NOT NULL
    BEGIN
        SET @sql = N'GRANT SELECT, INSERT, UPDATE ON OBJECT::[projects].[proposal_artifact] TO [' + @q + N'];';
        EXEC sp_executesql @sql;
    END
    IF OBJECT_ID(N'projects.proposal_history', N'U') IS NOT NULL
    BEGIN
        SET @sql = N'GRANT SELECT, INSERT ON OBJECT::[projects].[proposal_history] TO [' + @q + N'];';
        EXEC sp_executesql @sql;
    END
    IF OBJECT_ID(N'projects.proposal_config', N'U') IS NOT NULL
    BEGIN
        SET @sql = N'GRANT SELECT ON OBJECT::[projects].[proposal_config] TO [' + @q + N'];';
        EXEC sp_executesql @sql;
    END
    IF OBJECT_ID(N'projects.vw_proposal_version_blockers', N'V') IS NOT NULL
    BEGIN
        SET @sql = N'GRANT SELECT ON OBJECT::[projects].[vw_proposal_version_blockers] TO [' + @q + N'];';
        EXEC sp_executesql @sql;
    END

    FETCH NEXT FROM target_cursor INTO @principal;
END
CLOSE target_cursor;
DEALLOCATE target_cursor;
GO

PRINT N'Granted Project Workbench table access to field/dashboard readers.';
GO
