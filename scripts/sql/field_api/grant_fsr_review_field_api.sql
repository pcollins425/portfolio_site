/*
  Field API grants for FSR review tables.
  Run on dgs_application_db after 2026-07-22_fsr_review_case.sql.
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

    SET @sql = N'GRANT SELECT, INSERT, UPDATE ON OBJECT::[projects].[fsr_review_case] TO [' + @q + N'];';
    EXEC sp_executesql @sql;
    SET @sql = N'GRANT SELECT, INSERT, UPDATE ON OBJECT::[projects].[fsr_review_issue] TO [' + @q + N'];';
    EXEC sp_executesql @sql;

    FETCH NEXT FROM target_cursor INTO @principal;
END
CLOSE target_cursor;
DEALLOCATE target_cursor;
GO

PRINT N'Granted FSR review table access to field/dashboard readers.';
GO
