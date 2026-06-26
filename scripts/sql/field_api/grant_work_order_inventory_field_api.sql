-- Grants for work order materials + stock buckets (dgs_field_api).
-- Run after 2026-06-01_work_order_inventory_stock.sql

USE [dgs_application_db];
GO

GRANT SELECT, INSERT, UPDATE ON OBJECT::[inventory].[stock_balance] TO [dgs_field_api];
GO

GRANT SELECT, INSERT ON OBJECT::[inventory].[stock_movement] TO [dgs_field_api];
GO

GRANT SELECT, INSERT, UPDATE ON OBJECT::[projects].[work_order_material] TO [dgs_field_api];
GO

PRINT N'Granted work order inventory tables to dgs_field_api.';
GO
