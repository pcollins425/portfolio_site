/*
  Field / scanner API — SQL Authentication login (dgs_field_api).

  Replace BEFORE running:
    __REPLACE_FIELD_API_SQL_PASSWORD__  -> strong password (do not commit filled script)

  Run with privileged login (scripts/run_sql_file.py). Batches split on GO.

  Grants (dgs_application_db):
    SELECT, UPDATE  inventory.compinfo_landing
    SELECT, UPDATE  inventory.inventory
    SELECT  inventory.purchase_order
    SELECT  inventory.purchase_order_line
    SELECT, INSERT, UPDATE  inventory.stock_balance
    SELECT, INSERT       inventory.stock_movement
    SELECT, INSERT, UPDATE  projects.work_order_material
    SELECT  projects.emaint_landing
    SELECT  projects.work_orders
    INSERT, UPDATE  projects.work_orders
    SELECT, INSERT, UPDATE  inventory.stock_balance
    SELECT, INSERT       inventory.stock_movement
    SELECT, INSERT, UPDATE  projects.work_order_material

  Add more GRANT statements here as API endpoints grow.
*/

USE master;

IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'dgs_field_api')
BEGIN
    CREATE LOGIN [dgs_field_api]
    WITH
        PASSWORD = N'__REPLACE_FIELD_API_SQL_PASSWORD__',
        DEFAULT_DATABASE = [dgs_application_db],
        CHECK_POLICY = ON,
        CHECK_EXPIRATION = OFF;
END
ELSE
BEGIN
    ALTER LOGIN [dgs_field_api] WITH PASSWORD = N'__REPLACE_FIELD_API_SQL_PASSWORD__';
END
GO

USE [dgs_application_db];

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'dgs_field_api')
    CREATE USER [dgs_field_api] FOR LOGIN [dgs_field_api];
GO

GRANT CONNECT TO [dgs_field_api];
GO

GRANT SELECT, UPDATE ON OBJECT::[inventory].[compinfo_landing] TO [dgs_field_api];
GO

GRANT SELECT, UPDATE ON OBJECT::[inventory].[inventory] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[inventory].[purchase_order] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[inventory].[purchase_order_line] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[projects].[emaint_landing] TO [dgs_field_api];
GO

GRANT SELECT ON OBJECT::[projects].[work_orders] TO [dgs_field_api];
GO

GRANT INSERT, UPDATE ON OBJECT::[projects].[work_orders] TO [dgs_field_api];
GO

GRANT SELECT, INSERT, UPDATE ON OBJECT::[inventory].[stock_balance] TO [dgs_field_api];
GO

GRANT SELECT, INSERT ON OBJECT::[inventory].[stock_movement] TO [dgs_field_api];
GO

GRANT SELECT, INSERT, UPDATE ON OBJECT::[projects].[work_order_material] TO [dgs_field_api];
GO
