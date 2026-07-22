/*
  Seed dgs_fsr_review write access for Paul + Barry (human gate owners).
*/
USE [dgs_application_db];
GO

DECLARE @grant NVARCHAR(80) = N'dgs_fsr_review: ALL_CHANGES';

UPDATE er
SET
    er.[override_permissions] = CASE
        WHEN er.[override_permissions] IS NULL OR LTRIM(RTRIM(er.[override_permissions])) = N''
            THEN @grant
        WHEN er.[override_permissions] LIKE N'%dgs_fsr_review:%'
            THEN er.[override_permissions]
        ELSE LTRIM(RTRIM(er.[override_permissions])) + N' , ' + @grant
    END,
    er.[update_date] = GETDATE(),
    er.[update_by] = N'FSR review seed'
FROM [employees].[employee_roles] er
WHERE er.[active] = 1
  AND (
        LOWER(er.[email]) IN (
            N'paulc@dynamicgamingsolutions.com',
            N'barryd@dynamicgamingsolutions.com'
        )
        OR er.[reference_key] IN (N'EMP-000040', N'EMP-000068')
      );
GO

SELECT er.[reference_key], er.[name], er.[email], er.[override_permissions]
FROM [employees].[employee_roles] er
WHERE er.[override_permissions] LIKE N'%dgs_fsr_review:%';
GO
