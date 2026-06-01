/*
  One-time seed: inventory.inventory.onhand -> stock_balance WAREHOUSE / AVAILABLE.
  Skips items with no item number or zero onhand. Does not subtract existing balances.
*/
USE [dgs_application_db];
GO

INSERT INTO inventory.stock_balance (reference_key, item, bucket, condition, qty)
SELECT
    CONCAT(N'T', LEFT(REPLACE(CAST(NEWID() AS nvarchar(36)), N'-', N''), 12)),
    i.item,
    N'WAREHOUSE',
    N'AVAILABLE',
    i.onhand
FROM inventory.inventory AS i
WHERE i.item IS NOT NULL
  AND i.onhand IS NOT NULL
  AND i.onhand > 0
  AND NOT EXISTS (
      SELECT 1
      FROM inventory.stock_balance AS b
      WHERE b.item = i.item
        AND b.bucket = N'WAREHOUSE'
        AND b.condition = N'AVAILABLE'
  );

PRINT CONCAT(N'Seeded stock_balance rows: ', @@ROWCOUNT);
GO
