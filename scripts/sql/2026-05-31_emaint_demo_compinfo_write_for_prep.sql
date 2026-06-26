/*
  Asset prep status (scan → move) requires write on emaint_demo_compinfo.

  App: POST /api/emaint-demo/compinfo/prep-status checks employees.* RBAC.
  SQL: dgs_field_api also needs UPDATE on inventory.compinfo_landing (separate grant).

  Run on dgs_application_db (privileged login).
*/
USE [dgs_application_db];
GO

-- Demo role template (if present)
UPDATE [employees].[roles]
SET
    [permissions] = REPLACE(
        [permissions],
        N'emaint_demo_compinfo: READ_ONLY',
        N'emaint_demo_compinfo: UPDATES_ONLY'
    ),
    [update_date] = GETDATE(),
    [update_by] = N'eMaint demo compinfo prep write'
WHERE [permissions] LIKE N'%emaint_demo_compinfo: READ_ONLY%';
GO

-- Per-user overrides (Paul, Barry, anyone else seeded READ_ONLY on compinfo)
UPDATE [employees].[employee_roles]
SET
    [override_permissions] = REPLACE(
        [override_permissions],
        N'emaint_demo_compinfo: READ_ONLY',
        N'emaint_demo_compinfo: UPDATES_ONLY'
    ),
    [update_date] = GETDATE(),
    [update_by] = N'eMaint demo compinfo prep write'
WHERE [override_permissions] LIKE N'%emaint_demo_compinfo: READ_ONLY%';
GO

-- Field API mirror after eMaint Record (no-op if already granted)
GRANT UPDATE ON OBJECT::[inventory].[compinfo_landing] TO [dgs_field_api];
GO
