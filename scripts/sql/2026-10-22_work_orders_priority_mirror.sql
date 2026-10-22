/*
  Mirror eMaint WORK.priority onto projects.work_orders for the Work Orders module.
  Safe to re-run. Does not recreate the landing→orders trigger — apply the updated
  trigger script after this so new upserts keep priority in sync:
    scripts/sql/create_trigger_work_landing_to_work_orders.sql
*/
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF COL_LENGTH(N'projects.work_orders', N'priority') IS NULL
BEGIN
    ALTER TABLE projects.work_orders ADD priority nvarchar(2) NULL;
    PRINT N'Added projects.work_orders.priority';
END
ELSE
    PRINT N'projects.work_orders.priority already present';
GO

UPDATE wo
SET wo.priority = NULLIF(LTRIM(RTRIM(l.priority)), N'')
FROM projects.work_orders AS wo
INNER JOIN projects.work_landing AS l ON l.wo = wo.wo
WHERE ISNULL(wo.priority, N'') <> ISNULL(NULLIF(LTRIM(RTRIM(l.priority)), N''), N'');
PRINT N'Backfilled priority from work_landing';
GO
