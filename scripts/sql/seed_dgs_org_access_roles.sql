/*
  DGS App — org access roles + approved Finance / Admin / Workspace grants.

  Note: employees.roles.reference_key is trigger-assigned (RT-###). Upsert by [role] name.

  1) Ensure role templates exist (Org Browse / Finance / Workspace).
  2) Append sensitive area tokens to Paul + Barry overrides (idempotent).
  3) Does NOT mass-reassign role_id for all active employees.
     New hires: set role_id to the Org Browse RT-### (look up by role name) or leave empty
     with no Finance/Admin/Workspace overrides.

  Re-login after apply (JWT caches permissions ~12h).
*/
USE [dgs_application_db];
GO

/* ---- Org Browse ---- */
IF NOT EXISTS (SELECT 1 FROM [employees].[roles] WHERE [role] = N'DGS App — Org Browse')
BEGIN
    INSERT INTO [employees].[roles] (
        [uuid], [insert_date], [update_date], [update_by], [change_log], [role], [permissions]
    )
    VALUES (
        NEWID(), GETDATE(), GETDATE(), N'dgs_org_access_roles seed',
        N'DGS App org default: sign-in browse without Finance/Admin/Workspace.',
        N'DGS App — Org Browse',
        N''
    );
END
ELSE
BEGIN
    UPDATE [employees].[roles]
    SET [permissions] = N'',
        [update_date] = GETDATE(),
        [update_by] = N'dgs_org_access_roles seed'
    WHERE [role] = N'DGS App — Org Browse';
END
GO

/* ---- Finance ---- */
IF NOT EXISTS (SELECT 1 FROM [employees].[roles] WHERE [role] = N'DGS App — Finance')
BEGIN
    INSERT INTO [employees].[roles] (
        [uuid], [insert_date], [update_date], [update_by], [change_log], [role], [permissions]
    )
    VALUES (
        NEWID(), GETDATE(), GETDATE(), N'dgs_org_access_roles seed',
        N'DGS App Finance pack: expenses browse + mass edit + billing dashboard.',
        N'DGS App — Finance',
        N'expenses: UPDATES_ONLY, dgs_expenses_mass_edit: UPDATES_ONLY, dgs_finance_dashboard: READ_ONLY'
    );
END
ELSE
BEGIN
    UPDATE [employees].[roles]
    SET [permissions] = N'expenses: UPDATES_ONLY, dgs_expenses_mass_edit: UPDATES_ONLY, dgs_finance_dashboard: READ_ONLY',
        [update_date] = GETDATE(),
        [update_by] = N'dgs_org_access_roles seed'
    WHERE [role] = N'DGS App — Finance';
END
GO

/* ---- Workspace ---- */
IF NOT EXISTS (SELECT 1 FROM [employees].[roles] WHERE [role] = N'DGS App — Workspace')
BEGIN
    INSERT INTO [employees].[roles] (
        [uuid], [insert_date], [update_date], [update_by], [change_log], [role], [permissions]
    )
    VALUES (
        NEWID(), GETDATE(), GETDATE(), N'dgs_org_access_roles seed',
        N'DGS App Workspace pack: Assistant + secrets.',
        N'DGS App — Workspace',
        N'dgs_assistant: UPDATES_ONLY, dgs_assistant_secrets: UPDATES_ONLY'
    );
END
ELSE
BEGIN
    UPDATE [employees].[roles]
    SET [permissions] = N'dgs_assistant: UPDATES_ONLY, dgs_assistant_secrets: UPDATES_ONLY',
        [update_date] = GETDATE(),
        [update_by] = N'dgs_org_access_roles seed'
    WHERE [role] = N'DGS App — Workspace';
END
GO

/* ---- Append sensitive tokens to Paul + Barry (approved) ---- */
DECLARE @ref NVARCHAR(25);
DECLARE @blob NVARCHAR(MAX);
DECLARE @token NVARCHAR(120);
DECLARE @tokens TABLE (token NVARCHAR(120));
INSERT INTO @tokens (token) VALUES
    (N'expenses: ALL_CHANGES'),
    (N'dgs_expenses_mass_edit: ALL_CHANGES'),
    (N'dgs_finance_dashboard: ALL_CHANGES'),
    (N'dgs_assistant: ALL_CHANGES'),
    (N'dgs_assistant_secrets: ALL_CHANGES'),
    (N'employees: ADDS_AND_UPDATES'),
    (N'roles: ADDS_AND_UPDATES');

DECLARE refs CURSOR LOCAL FAST_FORWARD FOR
    SELECT er.reference_key
    FROM employees.employee_roles er
    WHERE er.active = 1
      AND (
            er.reference_key IN (N'EMP-000040', N'EMP-000068')
            OR LOWER(er.email) IN (
                N'paulc@dynamicgamingsolutions.com',
                N'barryd@dynamicgamingsolutions.com'
            )
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

        IF @blob IS NULL
           OR CHARINDEX(
                LEFT(@token, CHARINDEX(N':', @token)),
                ISNULL(@blob, N'')
              ) = 0
        BEGIN
            UPDATE employees.employee_roles
            SET
                override_permissions = CASE
                    WHEN override_permissions IS NULL OR LTRIM(RTRIM(override_permissions)) = N''
                        THEN @token
                    ELSE LTRIM(RTRIM(override_permissions)) + N', ' + @token
                END,
                update_date = GETDATE(),
                update_by = N'dgs_org_access_roles seed'
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
    er.update_by = N'dgs_org_access_roles seed'
FROM employees.employee_roles er
LEFT JOIN employees.roles r ON r.reference_key = er.role_id
WHERE er.active = 1
  AND (
        er.reference_key IN (N'EMP-000040', N'EMP-000068')
        OR LOWER(er.email) IN (
            N'paulc@dynamicgamingsolutions.com',
            N'barryd@dynamicgamingsolutions.com'
        )
      );
GO

SELECT reference_key, role, LEFT(ISNULL(permissions, N''), 120) AS permissions_head
FROM employees.roles
WHERE role LIKE N'DGS App — %'
ORDER BY role, reference_key;

SELECT reference_key, name, email,
       CASE WHEN CHARINDEX(N'dgs_assistant:', ISNULL(override_permissions, N'')) > 0 THEN 1 ELSE 0 END AS has_assistant,
       CASE WHEN CHARINDEX(N'dgs_finance_dashboard:', ISNULL(override_permissions, N'')) > 0 THEN 1 ELSE 0 END AS has_fin_dash,
       CASE WHEN CHARINDEX(N'dgs_expenses_mass_edit:', ISNULL(override_permissions, N'')) > 0 THEN 1 ELSE 0 END AS has_mass_edit
FROM employees.employee_roles
WHERE reference_key IN (N'EMP-000040', N'EMP-000068')
   OR LOWER(email) IN (N'paulc@dynamicgamingsolutions.com', N'barryd@dynamicgamingsolutions.com');
GO
