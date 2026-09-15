/*
  1) Barry: analyst + commission + employees/roles write (secondary admin).
  2) Paul (EMP-000040): full catalog at max level per area — system Admin.
  Refreshes combined_permissions from role + overrides.
*/
USE [dgs_application_db];
GO

/* ---- Barry (and any listed) — narrow admin bundle ---- */
DECLARE @ref NVARCHAR(25);
DECLARE @blob NVARCHAR(MAX);
DECLARE @token NVARCHAR(80);
DECLARE @tokens TABLE (token NVARCHAR(80));
INSERT INTO @tokens (token) VALUES
    (N'dgs_analyst: UPDATES_ONLY'),
    (N'dgs_commission: UPDATES_ONLY'),
    (N'employees: ADDS_AND_UPDATES'),
    (N'roles: ADDS_AND_UPDATES');

DECLARE refs CURSOR LOCAL FAST_FORWARD FOR
    SELECT er.reference_key
    FROM employees.employee_roles er
    WHERE er.active = 1
      AND (
            LOWER(er.email) = N'barryd@dynamicgamingsolutions.com'
            OR er.reference_key = N'EMP-000068'
          );

OPEN refs;
FETCH NEXT FROM refs INTO @ref;
WHILE @@FETCH_STATUS = 0
BEGIN
    DECLARE tok CURSOR LOCAL FAST_FORWARD FOR SELECT token FROM @tokens;
    OPEN tok;
    FETCH NEXT FROM tok INTO @token;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SELECT @blob = override_permissions
        FROM employees.employee_roles
        WHERE reference_key = @ref;

        IF @blob IS NULL OR CHARINDEX(LEFT(@token, CHARINDEX(N':', @token)), ISNULL(@blob, N'')) = 0
        BEGIN
            UPDATE employees.employee_roles
            SET
                override_permissions = CASE
                    WHEN override_permissions IS NULL OR LTRIM(RTRIM(override_permissions)) = N''
                        THEN @token
                    ELSE LTRIM(RTRIM(override_permissions)) + N', ' + @token
                END,
                update_date = GETDATE(),
                update_by = N'dgs_admin_permissions seed'
            WHERE reference_key = @ref;
        END

        FETCH NEXT FROM tok INTO @token;
    END
    CLOSE tok;
    DEALLOCATE tok;

    FETCH NEXT FROM refs INTO @ref;
END
CLOSE refs;
DEALLOCATE refs;
GO

/* ---- Paul — full Admin override blob (max level per catalog area) ---- */
DECLARE @paul_full NVARCHAR(MAX) = N''
    + N'employees: ALL_CHANGES, '
    + N'roles: ALL_CHANGES, '
    + N'states: ALL_CHANGES, '
    + N'casinos: ALL_CHANGES, '
    + N'tribes: ALL_CHANGES, '
    + N'vendors: ALL_CHANGES, '
    + N'cabinets: ALL_CHANGES, '
    + N'themes: ALL_CHANGES, '
    + N'slot_master: ALL_CHANGES, '
    + N'casino_master: ALL_CHANGES, '
    + N'full_slot_master: ALL_CHANGES, '
    + N'compliance: ALL_CHANGES, '
    + N'bill_validators: ALL_CHANGES, '
    + N'printers: ALL_CHANGES, '
    + N'order_details: ALL_CHANGES, '
    + N'sales_orders: ALL_CHANGES, '
    + N'activity: READ_ONLY, '
    + N'expenses: ALL_CHANGES, '
    + N'emaint_demo_projects: ALL_CHANGES, '
    + N'emaint_demo_work_orders: ALL_CHANGES, '
    + N'emaint_demo_field_techs: ALL_CHANGES, '
    + N'emaint_demo_compinfo: ALL_CHANGES, '
    + N'emaint_demo_inventory: ALL_CHANGES, '
    + N'emaint_demo_purchase_orders: ALL_CHANGES, '
    + N'dgs_projects_calendar: ALL_CHANGES, '
    + N'dgs_projects_catalog: ALL_CHANGES, '
    + N'dgs_fsr_review: ALL_CHANGES, '
    + N'dgs_performance_intake: ALL_CHANGES, '
    + N'dgs_analyst: ALL_CHANGES, '
    + N'dgs_commission: ALL_CHANGES, '
    + N'email: approval, '
    + N'email: legal, '
    + N'email: sales, '
    + N'email: order_signed';

UPDATE er
SET
    er.override_permissions = @paul_full,
    er.combined_permissions = CASE
        WHEN r.permissions IS NULL OR LTRIM(RTRIM(r.permissions)) = N''
            THEN @paul_full
        ELSE LTRIM(RTRIM(r.permissions)) + N', ' + @paul_full
    END,
    er.update_date = GETDATE(),
    er.update_by = N'dgs_admin_permissions seed (Paul full)'
FROM employees.employee_roles er
LEFT JOIN employees.roles r ON r.reference_key = er.role_id
WHERE er.active = 1
  AND (
        LOWER(er.email) = N'paulc@dynamicgamingsolutions.com'
        OR er.reference_key = N'EMP-000040'
      );
GO

/* Refresh Barry combined_permissions simply: leave AppSheet merge to runtime;
   still stamp combined as role + override for Asset Locator consumers. */
UPDATE er
SET
    er.combined_permissions = CASE
        WHEN r.permissions IS NULL OR LTRIM(RTRIM(r.permissions)) = N''
            THEN er.override_permissions
        WHEN er.override_permissions IS NULL OR LTRIM(RTRIM(er.override_permissions)) = N''
            THEN r.permissions
        ELSE LTRIM(RTRIM(r.permissions)) + N', ' + LTRIM(RTRIM(er.override_permissions))
    END,
    er.update_date = GETDATE(),
    er.update_by = N'dgs_admin_permissions seed'
FROM employees.employee_roles er
LEFT JOIN employees.roles r ON r.reference_key = er.role_id
WHERE er.active = 1
  AND (
        LOWER(er.email) = N'barryd@dynamicgamingsolutions.com'
        OR er.reference_key = N'EMP-000068'
      );
GO

SELECT reference_key, name, email,
       LEFT(override_permissions, 200) AS override_head,
       LEN(override_permissions) AS override_len
FROM employees.employee_roles
WHERE reference_key IN (N'EMP-000040', N'EMP-000068')
   OR LOWER(email) IN (N'paulc@dynamicgamingsolutions.com', N'barryd@dynamicgamingsolutions.com');
GO
