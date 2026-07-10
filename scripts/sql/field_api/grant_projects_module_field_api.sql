-- Field API (dgs_field_api): Projects module reads (dgsapp Calendar/Catalog/printout).
-- Run on dgs_application_db. Idempotent.
--
-- /api/projects/* queries: ims (already granted), project_catalog,
-- project_details, project_status, action_types, project_printout view
-- (per-action views + fn_project_line_ssot_fields chain under same owner).
--
-- Re-run after any DROP/CREATE of projects.project_printout (e.g. sold printout
-- migration 2026-07-10) — SQL Server does not preserve view grants on recreate.

USE [dgs_application_db];
GO

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'dgs_field_api')
BEGIN
    RAISERROR(N'dgs_field_api user missing — run setup_field_api_login.sql first.', 16, 1);
    RETURN;
END;
GO

GRANT SELECT ON OBJECT::[projects].[project_catalog] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[projects].[project_details] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[projects].[project_status] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[projects].[action_types] TO [dgs_field_api];
GO

IF OBJECT_ID(N'projects.sold_details', N'U') IS NOT NULL
    GRANT SELECT ON OBJECT::[projects].[sold_details] TO [dgs_field_api];
GO

IF OBJECT_ID(N'projects.project_sold_printout', N'V') IS NOT NULL
    GRANT SELECT ON OBJECT::[projects].[project_sold_printout] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[projects].[project_printout] TO [dgs_field_api];
GO

PRINT N'Granted SELECT on projects catalog/details/status/action_types/sold/printout to dgs_field_api.';
GO
