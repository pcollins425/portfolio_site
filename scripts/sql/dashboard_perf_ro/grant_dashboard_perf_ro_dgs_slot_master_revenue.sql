/*
  Companion to create_dashboard_perf_login_user_TEMPLATE.sql

  Reason: dashboard.vw_performance_report (in MSSQL_DATABASE) reads
          [DGS_SLOT].[dbo].[Master_Revenue]. The caller dashboard_perf_ro
          must CONNECT to DGS_SLOT and SELECT that table unless you use a
          more advanced chaining / EXECUTE AS design.

  Prerequisite: server login dashboard_perf_ro already exists
                (TEMPLATE script batch 1, or CREATE LOGIN separately).

  Run once as an admin-equivalent principal.
*/

USE [DGS_SLOT];

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'dashboard_perf_ro')
    CREATE USER [dashboard_perf_ro] FOR LOGIN [dashboard_perf_ro];

GRANT CONNECT TO [dashboard_perf_ro];
GRANT SELECT ON OBJECT::[dbo].[Master_Revenue] TO [dashboard_perf_ro];
GO
