/*
  FK prerequisites: SQL Server requires a non-filtered UNIQUE constraint on referenced columns.
  inventory.inventory.item and projects.work_orders.wo already have filtered unique indexes.
*/
USE [dgs_application_db];
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.key_constraints
    WHERE [name] = N'UQ_inventory_inventory_item_fk'
      AND [parent_object_id] = OBJECT_ID(N'inventory.inventory')
)
BEGIN
    ALTER TABLE [inventory].[inventory]
    ADD CONSTRAINT [UQ_inventory_inventory_item_fk] UNIQUE ([item]);
    PRINT N'Added UQ_inventory_inventory_item_fk on inventory.inventory(item).';
END
ELSE
    PRINT N'UQ_inventory_inventory_item_fk already exists.';
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.key_constraints
    WHERE [name] = N'UQ_projects_work_orders_wo_fk'
      AND [parent_object_id] = OBJECT_ID(N'projects.work_orders')
)
BEGIN
    ALTER TABLE [projects].[work_orders]
    ADD CONSTRAINT [UQ_projects_work_orders_wo_fk] UNIQUE ([wo]);
    PRINT N'Added UQ_projects_work_orders_wo_fk on projects.work_orders(wo).';
END
ELSE
    PRINT N'UQ_projects_work_orders_wo_fk already exists.';
GO
