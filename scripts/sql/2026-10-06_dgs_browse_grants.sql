/*
  Performance, contracts, deals, and software vault used to be open to every
  signed-in employee. They are grants now. Every role except Technician
  keeps today's access. Technician stays without them, so an employee
  override can open one area.

  Workbench is already its own grant (dgs_projects_workbench) and is not added here.
*/
DECLARE @grant nvarchar(400) = N'dgs_performance: READ_ONLY, dgs_contracts: READ_ONLY, dgs_deals: READ_ONLY, dgs_software_vault: READ_ONLY';

UPDATE employees.roles
SET permissions = CASE
      WHEN NULLIF(LTRIM(RTRIM(permissions)), N'') IS NULL THEN @grant
      ELSE RTRIM(permissions) + N', ' + @grant
    END,
    update_date = GETDATE(),
    update_by = 'dgs browse grants'
WHERE reference_key <> N'RT-030'
  AND CHARINDEX(N'dgs_performance:', ISNULL(permissions, N'')) = 0;
