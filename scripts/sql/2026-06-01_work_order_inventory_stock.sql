/*
  Work order parts + warehouse stock buckets (app SSOT).

  FK conventions:
    - work_order_material.wo  -> projects.work_orders.wo (native eMaint WO No.)
    - stock_balance.item / stock_movement.item -> inventory.inventory.item
    - work_order_material.item -> inventory.inventory.item

  Reference keys (triggers): WOM-, STB-, STM-

  Run on dgs_application_db (privileged). Then:
    scripts/sql/field_api/grant_work_order_inventory_field_api.sql
*/

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- ---------------------------------------------------------------------------
-- inventory.stock_balance — qty by bucket + condition (per catalog item)
-- ---------------------------------------------------------------------------
IF OBJECT_ID(N'inventory.stock_balance', N'U') IS NULL
BEGIN
    IF OBJECT_ID(N'inventory.seq_stock_balance_index_key', N'SO') IS NULL
        CREATE SEQUENCE inventory.seq_stock_balance_index_key AS int START WITH 1 INCREMENT BY 1 CACHE 50;

    CREATE TABLE inventory.stock_balance (
        reference_key nvarchar(32) NOT NULL,
        index_key int NOT NULL
            CONSTRAINT DF_inventory_stock_balance_index_key
            DEFAULT (NEXT VALUE FOR inventory.seq_stock_balance_index_key),
        item nvarchar(15) NOT NULL,
        bucket nvarchar(64) NOT NULL,
        condition nvarchar(20) NOT NULL,
        qty decimal(12, 3) NOT NULL
            CONSTRAINT DF_inventory_stock_balance_qty DEFAULT (0),
        updated_at datetime2(7) NOT NULL
            CONSTRAINT DF_inventory_stock_balance_updated_at DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT PK_inventory_stock_balance PRIMARY KEY CLUSTERED (reference_key),
        CONSTRAINT CK_inventory_stock_balance_qty_nonneg CHECK (qty >= 0),
        CONSTRAINT CK_inventory_stock_balance_condition CHECK (
            condition IN (N'AVAILABLE', N'REFURB', N'HOLD', N'ALLOCATED', N'DAMAGED')
        ),
        CONSTRAINT UQ_inventory_stock_balance_item_bucket_condition
            UNIQUE (item, bucket, condition),
        CONSTRAINT FK_inventory_stock_balance_item
            FOREIGN KEY (item) REFERENCES inventory.inventory (item)
    );

    CREATE NONCLUSTERED INDEX IX_inventory_stock_balance_item
    ON inventory.stock_balance (item);

    PRINT N'Created inventory.stock_balance.';
END
ELSE
    PRINT N'inventory.stock_balance already exists; skipping CREATE.';
GO

-- ---------------------------------------------------------------------------
-- projects.work_order_material — parts on a WO (native wo FK)
-- ---------------------------------------------------------------------------
IF OBJECT_ID(N'projects.work_order_material', N'U') IS NULL
BEGIN
    IF OBJECT_ID(N'projects.seq_work_order_material_index_key', N'SO') IS NULL
        CREATE SEQUENCE projects.seq_work_order_material_index_key AS int START WITH 1 INCREMENT BY 1 CACHE 50;

    CREATE TABLE projects.work_order_material (
        reference_key nvarchar(32) NOT NULL,
        index_key int NOT NULL
            CONSTRAINT DF_projects_work_order_material_index_key
            DEFAULT (NEXT VALUE FOR projects.seq_work_order_material_index_key),
        wo nvarchar(20) NOT NULL,
        item nvarchar(15) NOT NULL,
        qty_requested decimal(12, 3) NOT NULL
            CONSTRAINT DF_projects_work_order_material_qty_requested DEFAULT (0),
        qty_allocated decimal(12, 3) NOT NULL
            CONSTRAINT DF_projects_work_order_material_qty_allocated DEFAULT (0),
        qty_issued decimal(12, 3) NOT NULL
            CONSTRAINT DF_projects_work_order_material_qty_issued DEFAULT (0),
        status nvarchar(20) NOT NULL
            CONSTRAINT DF_projects_work_order_material_status DEFAULT (N'draft'),
        created_at datetime2(7) NOT NULL
            CONSTRAINT DF_projects_work_order_material_created_at DEFAULT (SYSUTCDATETIME()),
        updated_at datetime2(7) NOT NULL
            CONSTRAINT DF_projects_work_order_material_updated_at DEFAULT (SYSUTCDATETIME()),

        CONSTRAINT PK_projects_work_order_material PRIMARY KEY CLUSTERED (reference_key),
        CONSTRAINT CK_projects_work_order_material_status CHECK (
            status IN (N'draft', N'allocated', N'issued', N'consumed', N'cancelled')
        ),
        CONSTRAINT UQ_projects_work_order_material_wo_item UNIQUE (wo, item),
        CONSTRAINT FK_projects_work_order_material_wo
            FOREIGN KEY (wo) REFERENCES projects.work_orders (wo),
        CONSTRAINT FK_projects_work_order_material_item
            FOREIGN KEY (item) REFERENCES inventory.inventory (item)
    );

    CREATE NONCLUSTERED INDEX IX_projects_work_order_material_wo
    ON projects.work_order_material (wo);

    PRINT N'Created projects.work_order_material.';
END
ELSE
    PRINT N'projects.work_order_material already exists; skipping CREATE.';
GO

-- ---------------------------------------------------------------------------
-- inventory.stock_movement — audit ledger
-- ---------------------------------------------------------------------------
IF OBJECT_ID(N'inventory.stock_movement', N'U') IS NULL
BEGIN
    IF OBJECT_ID(N'inventory.seq_stock_movement_index_key', N'SO') IS NULL
        CREATE SEQUENCE inventory.seq_stock_movement_index_key AS int START WITH 1 INCREMENT BY 1 CACHE 50;

    CREATE TABLE inventory.stock_movement (
        reference_key nvarchar(32) NOT NULL,
        index_key int NOT NULL
            CONSTRAINT DF_inventory_stock_movement_index_key
            DEFAULT (NEXT VALUE FOR inventory.seq_stock_movement_index_key),
        item nvarchar(15) NOT NULL,
        from_bucket nvarchar(64) NULL,
        from_condition nvarchar(20) NULL,
        to_bucket nvarchar(64) NOT NULL,
        to_condition nvarchar(20) NOT NULL,
        qty decimal(12, 3) NOT NULL,
        wo nvarchar(20) NULL,
        work_order_material_id nvarchar(32) NULL,
        note nvarchar(200) NULL,
        created_at datetime2(7) NOT NULL
            CONSTRAINT DF_inventory_stock_movement_created_at DEFAULT (SYSUTCDATETIME()),
        created_by nvarchar(128) NULL,

        CONSTRAINT PK_inventory_stock_movement PRIMARY KEY CLUSTERED (reference_key),
        CONSTRAINT CK_inventory_stock_movement_qty_pos CHECK (qty > 0),
        CONSTRAINT FK_inventory_stock_movement_item
            FOREIGN KEY (item) REFERENCES inventory.inventory (item),
        CONSTRAINT FK_inventory_stock_movement_wo_material
            FOREIGN KEY (work_order_material_id) REFERENCES projects.work_order_material (reference_key)
    );

    CREATE NONCLUSTERED INDEX IX_inventory_stock_movement_item_created
    ON inventory.stock_movement (item, created_at DESC);

    CREATE NONCLUSTERED INDEX IX_inventory_stock_movement_wo
    ON inventory.stock_movement (wo)
    WHERE wo IS NOT NULL;

    PRINT N'Created inventory.stock_movement.';
END
ELSE
    PRINT N'inventory.stock_movement already exists; skipping CREATE.';
GO
