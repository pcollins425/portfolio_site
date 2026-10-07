/*
  Seed dgs_mail_intake on Paul + Barry (Workspace · Mail Intake).
  Idempotent: appends token only when area prefix missing.
*/
USE [dgs_application_db];
GO

DECLARE @ref NVARCHAR(25);
DECLARE @token NVARCHAR(80) = N'dgs_mail_intake: ALL_CHANGES';
DECLARE @blob NVARCHAR(MAX);

DECLARE refs CURSOR LOCAL FAST_FORWARD FOR
    SELECT er.reference_key
    FROM employees.employee_roles er
    WHERE er.active = 1
      AND (
            LOWER(er.email) IN (
                N'paulc@dynamicgamingsolutions.com',
                N'barryd@dynamicgamingsolutions.com'
            )
            OR er.reference_key IN (N'EMP-000040', N'EMP-000068')
          );

OPEN refs;
FETCH NEXT FROM refs INTO @ref;
WHILE @@FETCH_STATUS = 0
BEGIN
    SELECT @blob = override_permissions
    FROM employees.employee_roles
    WHERE reference_key = @ref;

    IF @blob IS NULL OR CHARINDEX(N'dgs_mail_intake:', ISNULL(@blob, N'')) = 0
    BEGIN
        UPDATE employees.employee_roles
        SET
            override_permissions = CASE
                WHEN override_permissions IS NULL OR LTRIM(RTRIM(override_permissions)) = N''
                    THEN @token
                ELSE LTRIM(RTRIM(override_permissions)) + N', ' + @token
            END,
            update_date = GETDATE(),
            update_by = N'dgs_mail_intake seed'
        WHERE reference_key = @ref;
    END

    /* Refresh combined from role + overrides */
    UPDATE er
    SET er.combined_permissions = CASE
            WHEN r.permissions IS NULL OR LTRIM(RTRIM(r.permissions)) = N''
                THEN er.override_permissions
            WHEN er.override_permissions IS NULL OR LTRIM(RTRIM(er.override_permissions)) = N''
                THEN r.permissions
            ELSE LTRIM(RTRIM(r.permissions)) + N', ' + LTRIM(RTRIM(er.override_permissions))
        END,
        er.update_date = GETDATE(),
        er.update_by = N'dgs_mail_intake seed (combined)'
    FROM employees.employee_roles er
    LEFT JOIN employees.roles r ON r.reference_key = er.role_id
    WHERE er.reference_key = @ref;

    FETCH NEXT FROM refs INTO @ref;
END
CLOSE refs;
DEALLOCATE refs;
GO

PRINT N'seed_dgs_mail_intake_permissions: done (re-login required).';
GO
