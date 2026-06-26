-- reference_key triggers: STB-, WOM-, STM-

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

CREATE OR ALTER TRIGGER inventory.tr_stock_balance_normalize_reference_key
ON inventory.stock_balance
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL(
            OBJECT_ID(N'inventory.tr_stock_balance_normalize_reference_key', N'TR'),
            N'AFTER',
            N'DML'
        ) > 1
        RETURN;
    IF EXISTS (SELECT 1 FROM deleted)
       AND UPDATE(reference_key)
       AND NOT UPDATE(index_key)
        RETURN;

    UPDATE t
    SET reference_key = CONCAT(
            N'STB-',
            RIGHT(REPLICATE(N'0', 10) + CAST(t.index_key AS nvarchar(20)), 10)
        )
    FROM inventory.stock_balance AS t
    INNER JOIN inserted AS i ON i.reference_key = t.reference_key;
END;
GO

CREATE OR ALTER TRIGGER projects.tr_work_order_material_normalize_reference_key
ON projects.work_order_material
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL(
            OBJECT_ID(N'projects.tr_work_order_material_normalize_reference_key', N'TR'),
            N'AFTER',
            N'DML'
        ) > 1
        RETURN;
    IF EXISTS (SELECT 1 FROM deleted)
       AND UPDATE(reference_key)
       AND NOT UPDATE(index_key)
        RETURN;

    UPDATE t
    SET reference_key = CONCAT(
            N'WOM-',
            RIGHT(REPLICATE(N'0', 10) + CAST(t.index_key AS nvarchar(20)), 10)
        )
    FROM projects.work_order_material AS t
    INNER JOIN inserted AS i ON i.reference_key = t.reference_key;
END;
GO

CREATE OR ALTER TRIGGER inventory.tr_stock_movement_normalize_reference_key
ON inventory.stock_movement
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    IF TRIGGER_NESTLEVEL(
            OBJECT_ID(N'inventory.tr_stock_movement_normalize_reference_key', N'TR'),
            N'AFTER',
            N'DML'
        ) > 1
        RETURN;
    IF EXISTS (SELECT 1 FROM deleted)
       AND UPDATE(reference_key)
       AND NOT UPDATE(index_key)
        RETURN;

    UPDATE t
    SET reference_key = CONCAT(
            N'STM-',
            RIGHT(REPLICATE(N'0', 10) + CAST(t.index_key AS nvarchar(20)), 10)
        )
    FROM inventory.stock_movement AS t
    INNER JOIN inserted AS i ON i.reference_key = t.reference_key;
END;
GO

PRINT N'Work order inventory reference_key triggers installed.';
GO
