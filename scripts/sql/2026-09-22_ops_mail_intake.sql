-- ops schema: dual-mailbox mail intake (accounting@ + paulc@)
-- Apply: python3 scripts/mail_intake/apply_ddl.py
--    or: python3 scripts/apply_sql_migration.py scripts/migrations/2026-09-22_ops_mail_intake.sql

SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'ops')
    EXEC(N'CREATE SCHEMA ops');
GO

IF OBJECT_ID(N'ops.mail_mailbox_state', N'U') IS NULL
BEGIN
    CREATE TABLE ops.mail_mailbox_state (
        mailbox              nvarchar(120) NOT NULL,
        last_history_id      nvarchar(50)  NULL,
        last_internal_date   datetime2(3)  NULL,
        last_poll_at         datetime2(3)  NULL,
        last_success_at      datetime2(3)  NULL,
        updated_at           datetime2(3)  NOT NULL
            CONSTRAINT DF_ops_mail_mailbox_state_updated
            DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_ops_mail_mailbox_state PRIMARY KEY CLUSTERED (mailbox)
    );
    PRINT N'Created ops.mail_mailbox_state.';
END
ELSE
    PRINT N'ops.mail_mailbox_state already exists.';
GO

IF OBJECT_ID(N'ops.mail_intake', N'U') IS NULL
BEGIN
    CREATE TABLE ops.mail_intake (
        uuid                 uniqueidentifier NOT NULL
            CONSTRAINT DF_ops_mail_intake_uuid DEFAULT (NEWID()),
        index_key            int IDENTITY(1, 1) NOT NULL,
        mailbox              nvarchar(120) NOT NULL,
        message_id           nvarchar(64)  NOT NULL,
        thread_id            nvarchar(64)  NULL,
        internal_date        datetime2(3)  NULL,
        gmail_from           nvarchar(500) NULL,
        subject              nvarchar(1000) NULL,
        snippet              nvarchar(500) NULL,
        has_attachments      bit           NOT NULL
            CONSTRAINT DF_ops_mail_intake_has_att DEFAULT (0),
        attachment_names     nvarchar(max) NULL,
        designation          nvarchar(20)  NOT NULL
            CONSTRAINT DF_ops_mail_intake_designation DEFAULT (N'unset'),
        designated_by        nvarchar(120) NULL,
        designated_at        datetime2(3)  NULL,
        process_status       nvarchar(30)  NOT NULL
            CONSTRAINT DF_ops_mail_intake_proc_status DEFAULT (N'none'),
        latest_job_id        uniqueidentifier NULL,
        checked_at           datetime2(3)  NOT NULL
            CONSTRAINT DF_ops_mail_intake_checked DEFAULT (SYSUTCDATETIME()),
        notes                nvarchar(max) NULL,
        CONSTRAINT PK_ops_mail_intake PRIMARY KEY CLUSTERED (index_key),
        CONSTRAINT UQ_ops_mail_intake_uuid UNIQUE (uuid),
        CONSTRAINT UQ_ops_mail_intake_mailbox_msg UNIQUE (mailbox, message_id),
        CONSTRAINT CK_ops_mail_intake_designation CHECK (
            designation IN (N'unset', N'revenue', N'fsr', N'ignore')
        ),
        CONSTRAINT CK_ops_mail_intake_proc_status CHECK (
            process_status IN (
                N'none', N'queued', N'running', N'dry_run_ok',
                N'needs_human', N'applied', N'failed'
            )
        )
    );

    CREATE NONCLUSTERED INDEX IX_ops_mail_intake_checked
        ON ops.mail_intake (checked_at DESC);

    CREATE NONCLUSTERED INDEX IX_ops_mail_intake_designation
        ON ops.mail_intake (designation, process_status, internal_date DESC);

    CREATE NONCLUSTERED INDEX IX_ops_mail_intake_mailbox_date
        ON ops.mail_intake (mailbox, internal_date DESC);

    PRINT N'Created ops.mail_intake.';
END
ELSE
    PRINT N'ops.mail_intake already exists.';
GO

IF OBJECT_ID(N'ops.mail_designation_event', N'U') IS NULL
BEGIN
    CREATE TABLE ops.mail_designation_event (
        event_id             uniqueidentifier NOT NULL
            CONSTRAINT DF_ops_mail_desig_event_id DEFAULT (NEWID()),
        index_key            int IDENTITY(1, 1) NOT NULL,
        intake_uuid          uniqueidentifier NOT NULL,
        mailbox              nvarchar(120) NOT NULL,
        message_id           nvarchar(64)  NOT NULL,
        thread_id            nvarchar(64)  NULL,
        gmail_from           nvarchar(500) NULL,
        subject              nvarchar(1000) NULL,
        snippet              nvarchar(500) NULL,
        has_attachments      bit           NOT NULL
            CONSTRAINT DF_ops_mail_desig_has_att DEFAULT (0),
        attachment_names     nvarchar(max) NULL,
        from_designation     nvarchar(20)  NOT NULL,
        to_designation       nvarchar(20)  NOT NULL,
        actor                nvarchar(120) NOT NULL,
        created_at           datetime2(3)  NOT NULL
            CONSTRAINT DF_ops_mail_desig_created DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_ops_mail_designation_event PRIMARY KEY CLUSTERED (index_key),
        CONSTRAINT UQ_ops_mail_designation_event_id UNIQUE (event_id)
    );

    CREATE NONCLUSTERED INDEX IX_ops_mail_desig_created
        ON ops.mail_designation_event (created_at DESC);

    CREATE NONCLUSTERED INDEX IX_ops_mail_desig_intake
        ON ops.mail_designation_event (intake_uuid, created_at DESC);

    PRINT N'Created ops.mail_designation_event.';
END
ELSE
    PRINT N'ops.mail_designation_event already exists.';
GO

IF OBJECT_ID(N'ops.mail_process_job', N'U') IS NULL
BEGIN
    CREATE TABLE ops.mail_process_job (
        job_id               uniqueidentifier NOT NULL
            CONSTRAINT DF_ops_mail_process_job_id DEFAULT (NEWID()),
        index_key            int IDENTITY(1, 1) NOT NULL,
        intake_uuid          uniqueidentifier NOT NULL,
        mailbox              nvarchar(120) NOT NULL,
        message_id           nvarchar(64)  NOT NULL,
        designation          nvarchar(20)  NOT NULL,
        mode                 nvarchar(20)  NOT NULL
            CONSTRAINT DF_ops_mail_process_mode DEFAULT (N'dry_run'),
        status               nvarchar(30)  NOT NULL
            CONSTRAINT DF_ops_mail_process_status DEFAULT (N'queued'),
        requested_by         nvarchar(120) NULL,
        started_at           datetime2(3)  NULL,
        finished_at          datetime2(3)  NULL,
        stage_path           nvarchar(1000) NULL,
        summary_json         nvarchar(max) NULL,
        error_text           nvarchar(max) NULL,
        created_at           datetime2(3)  NOT NULL
            CONSTRAINT DF_ops_mail_process_created DEFAULT (SYSUTCDATETIME()),
        updated_at           datetime2(3)  NOT NULL
            CONSTRAINT DF_ops_mail_process_updated DEFAULT (SYSUTCDATETIME()),
        CONSTRAINT PK_ops_mail_process_job PRIMARY KEY CLUSTERED (index_key),
        CONSTRAINT UQ_ops_mail_process_job_id UNIQUE (job_id),
        CONSTRAINT CK_ops_mail_process_designation CHECK (
            designation IN (N'revenue', N'fsr')
        ),
        CONSTRAINT CK_ops_mail_process_mode CHECK (
            mode IN (N'dry_run', N'apply')
        ),
        CONSTRAINT CK_ops_mail_process_status CHECK (
            status IN (
                N'queued', N'running', N'dry_run_ok',
                N'needs_human', N'applied', N'failed'
            )
        )
    );

    CREATE NONCLUSTERED INDEX IX_ops_mail_process_status
        ON ops.mail_process_job (status, created_at);

    CREATE NONCLUSTERED INDEX IX_ops_mail_process_intake
        ON ops.mail_process_job (intake_uuid, created_at DESC);

    PRINT N'Created ops.mail_process_job.';
END
ELSE
    PRINT N'ops.mail_process_job already exists.';
GO
