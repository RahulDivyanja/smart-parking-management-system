/**
 * Phase 6 TypeORM Migration: Reminder Sweeper schema extensions and booking event state tracking
 * Extends 'reminders' table with sweeper columns and creates 'booking_event_states' table
 */
class Phase6ReminderSweeperSchema1700000000002 {
  name = 'Phase6ReminderSweeperSchema1700000000002';

  /**
   * Run migration
   * @param {import('typeorm').QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // 1. Extend reminders table with Phase 6 columns
    await queryRunner.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('reminders') AND name = 'next_attempt_at')
      BEGIN
        ALTER TABLE [reminders] ADD [next_attempt_at] DATETIME2(0) NULL;
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('reminders') AND name = 'payload')
      BEGIN
        ALTER TABLE [reminders] ADD [payload] NVARCHAR(MAX) NULL;
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('reminders') AND name = 'retry_count')
      BEGIN
        ALTER TABLE [reminders] ADD [retry_count] INT NOT NULL DEFAULT 0;
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('reminders') AND name = 'last_error')
      BEGIN
        ALTER TABLE [reminders] ADD [last_error] NVARCHAR(MAX) NULL;
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('reminders') AND name = 'claim_owner')
      BEGIN
        ALTER TABLE [reminders] ADD [claim_owner] NVARCHAR(100) NULL;
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('reminders') AND name = 'claim_expires_at')
      BEGIN
        ALTER TABLE [reminders] ADD [claim_expires_at] DATETIME2(0) NULL;
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('reminders') AND name = 'claim_version')
      BEGIN
        ALTER TABLE [reminders] ADD [claim_version] INT NOT NULL DEFAULT 0;
      END
    `);

    // 2. Create optimized sweeping index
    await queryRunner.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_reminders_sweep_v2' AND object_id = OBJECT_ID('reminders'))
      BEGIN
        CREATE NONCLUSTERED INDEX [IX_reminders_sweep_v2]
        ON [reminders] ([is_active], [reminder_status], [scheduled_at], [next_attempt_at])
        INCLUDE ([claim_expires_at], [retry_count], [claim_version]);
      END
    `);

    // 3. Create booking_event_states table (facility_id NVARCHAR(50) NULL, no cross-DB foreign key)
    await queryRunner.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'booking_event_states')
      BEGIN
        CREATE TABLE [booking_event_states] (
          [booking_id] UNIQUEIDENTIFIER NOT NULL,
          [booking_reference] NVARCHAR(100) NULL,
          [user_id] NVARCHAR(100) NOT NULL,
          [facility_id] NVARCHAR(50) NULL,
          [current_status] NVARCHAR(50) NOT NULL,
          [has_created_event] BIT NOT NULL DEFAULT 0,
          [start_time] DATETIME2(0) NULL,
          [end_time] DATETIME2(0) NULL,
          [status_updated_at] DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
          [created_at] DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
          [updated_at] DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
          CONSTRAINT [PK_booking_event_states] PRIMARY KEY CLUSTERED ([booking_id])
        );
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_booking_event_states_status' AND object_id = OBJECT_ID('booking_event_states'))
      BEGIN
        CREATE NONCLUSTERED INDEX [IX_booking_event_states_status]
        ON [booking_event_states] ([current_status]);
      END
    `);
  }

  /**
   * Revert migration safely without dropping reminders table or losing existing reminder records
   * @param {import('typeorm').QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // 1. Safely drop Phase 6 sweeping index
    await queryRunner.query(`
      IF EXISTS (
        SELECT 1 FROM sys.indexes 
        WHERE name = 'IX_reminders_sweep_v2' 
          AND object_id = OBJECT_ID('reminders')
      )
      BEGIN
        DROP INDEX [IX_reminders_sweep_v2] ON [reminders];
      END
    `);

    // 2. Safely drop booking_event_states table
    await queryRunner.query(`
      IF EXISTS (
        SELECT 1 FROM sys.tables 
        WHERE name = 'booking_event_states'
      )
      BEGIN
        DROP TABLE [booking_event_states];
      END
    `);

    // 3. Dynamically discover and drop all default constraints on Phase 6 columns
    await queryRunner.query(`
      DECLARE @dropConstraintsSql NVARCHAR(MAX) = N'';

      SELECT @dropConstraintsSql += N'ALTER TABLE [reminders] DROP CONSTRAINT ' + QUOTENAME(dc.name) + N'; '
      FROM sys.default_constraints dc
      JOIN sys.columns c ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
      WHERE dc.parent_object_id = OBJECT_ID('reminders')
        AND c.name IN (
          'next_attempt_at',
          'payload',
          'retry_count',
          'last_error',
          'claim_owner',
          'claim_expires_at',
          'claim_version'
        );

      IF LEN(@dropConstraintsSql) > 0
      BEGIN
        EXEC sp_executesql @dropConstraintsSql;
      END
    `);

    // 4. Safely drop Phase 6 columns individually
    const phase6Columns = [
      'next_attempt_at',
      'payload',
      'retry_count',
      'last_error',
      'claim_owner',
      'claim_expires_at',
      'claim_version'
    ];

    for (const col of phase6Columns) {
      await queryRunner.query(`
        IF EXISTS (
          SELECT 1 FROM sys.columns 
          WHERE object_id = OBJECT_ID('reminders') 
            AND name = '${col}'
        )
        BEGIN
          ALTER TABLE [reminders] DROP COLUMN [${col}];
        END
      `);
    }
  }
}

module.exports = Phase6ReminderSweeperSchema1700000000002;
