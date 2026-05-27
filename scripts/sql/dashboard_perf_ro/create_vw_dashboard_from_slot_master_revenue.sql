/*
  Dashboard façade: expose DGS_SLOT.dbo.Master_Revenue rows from MSSQL_DATABASE
  (the catalog pymssql selects via MSSQL_DATABASE in .env — typically dgs_application_db).

  Cross-database SELECT requires the MSSQL_LOGIN used here to have SELECT on Master_Revenue
  (admin / privileged path for CREATE VIEW; downstream dashboard_perf_ro would need EXECUTE AS
   or analogous grants later if tightened).

  Corrected table name: Master_Revenue (not Master_Revenu).
*/

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'dashboard')
    EXEC (N'CREATE SCHEMA [dashboard] AUTHORIZATION [dbo]');
GO

CREATE OR ALTER VIEW [dashboard].[vw_performance_report]
AS
SELECT *
FROM [DGS_SLOT].[dbo].[Master_Revenue];
GO
