/**
 * Initial TypeORM Migration: Create notification service tables, constraints, and indexes
 * Targets: notifications, notification_delivery_logs, processed_events, reminders
 */
class InitialNotificationSchema1700000000001 {
  name = 'InitialNotificationSchema1700000000001';

  /**
   * Run migration
   * @param {import('typeorm').QueryRunner} queryRunner
   */
  async up(queryRunner) {
    // 1. Create processed_events table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'processed_events')
      BEGIN
        CREATE TABLE [processed_events] (
          [id] UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
          [event_id] NVARCHAR(100) NOT NULL,
          [event_type] NVARCHAR(100) NOT NULL,
          [processing_status] NVARCHAR(20) NOT NULL DEFAULT 'RECEIVED',
          [received_at] DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
          [processed_at] DATETIME2(0) NULL,
          [last_error] NVARCHAR(MAX) NULL,
          [retry_count] INT NOT NULL DEFAULT 0,
          CONSTRAINT [PK_processed_events_id] PRIMARY KEY CLUSTERED ([id]),
          CONSTRAINT [UQ_processed_events_event_id] UNIQUE NONCLUSTERED ([event_id])
        );
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_processed_events_status' AND object_id = OBJECT_ID('processed_events'))
      BEGIN
        CREATE NONCLUSTERED INDEX [IX_processed_events_status] 
        ON [processed_events] ([processing_status]);
      END
    `);

    // 2. Create notifications table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'notifications')
      BEGIN
        CREATE TABLE [notifications] (
          [id] UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
          [event_id] NVARCHAR(100) NULL,
          [idempotency_key] NVARCHAR(255) NULL,
          [user_id] NVARCHAR(100) NULL,
          [recipient_email] NVARCHAR(255) NOT NULL,
          [notification_type] NVARCHAR(50) NOT NULL,
          [subject] NVARCHAR(255) NOT NULL,
          [template_name] NVARCHAR(100) NOT NULL,
          [payload] NVARCHAR(MAX) NULL,
          [delivery_status] NVARCHAR(20) NOT NULL DEFAULT 'PENDING',
          [scheduled_at] DATETIME2(0) NULL,
          [sent_at] DATETIME2(0) NULL,
          [created_at] DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
          [updated_at] DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
          CONSTRAINT [PK_notifications_id] PRIMARY KEY CLUSTERED ([id])
        );
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'UQ_notifications_idempotency_key' AND object_id = OBJECT_ID('notifications'))
      BEGIN
        CREATE UNIQUE NONCLUSTERED INDEX [UQ_notifications_idempotency_key] 
        ON [notifications] ([idempotency_key]) 
        WHERE [idempotency_key] IS NOT NULL;
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_notifications_recipient_email' AND object_id = OBJECT_ID('notifications'))
      BEGIN
        CREATE NONCLUSTERED INDEX [IX_notifications_recipient_email] 
        ON [notifications] ([recipient_email]);
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_notifications_delivery_status' AND object_id = OBJECT_ID('notifications'))
      BEGIN
        CREATE NONCLUSTERED INDEX [IX_notifications_delivery_status] 
        ON [notifications] ([delivery_status]);
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_notifications_created_at' AND object_id = OBJECT_ID('notifications'))
      BEGIN
        CREATE NONCLUSTERED INDEX [IX_notifications_created_at] 
        ON [notifications] ([created_at]);
      END
    `);

    // 3. Create notification_delivery_logs table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'notification_delivery_logs')
      BEGIN
        CREATE TABLE [notification_delivery_logs] (
          [id] UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
          [notification_id] UNIQUEIDENTIFIER NOT NULL,
          [attempt_number] INT NOT NULL,
          [provider] NVARCHAR(50) NOT NULL DEFAULT 'SMTP',
          [delivery_status] NVARCHAR(20) NOT NULL,
          [attempted_at] DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
          [completed_at] DATETIME2(0) NULL,
          [error_message] NVARCHAR(MAX) NULL,
          [provider_message_id] NVARCHAR(255) NULL,
          CONSTRAINT [PK_notification_delivery_logs_id] PRIMARY KEY CLUSTERED ([id]),
          CONSTRAINT [FK_delivery_logs_notification] FOREIGN KEY ([notification_id]) 
            REFERENCES [notifications] ([id]) ON DELETE CASCADE
        );
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_delivery_logs_notification_id' AND object_id = OBJECT_ID('notification_delivery_logs'))
      BEGIN
        CREATE NONCLUSTERED INDEX [IX_delivery_logs_notification_id] 
        ON [notification_delivery_logs] ([notification_id]);
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_delivery_logs_delivery_status' AND object_id = OBJECT_ID('notification_delivery_logs'))
      BEGIN
        CREATE NONCLUSTERED INDEX [IX_delivery_logs_delivery_status] 
        ON [notification_delivery_logs] ([delivery_status]);
      END
    `);

    // 4. Create reminders table
    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'reminders')
      BEGIN
        CREATE TABLE [reminders] (
          [id] UNIQUEIDENTIFIER NOT NULL DEFAULT NEWSEQUENTIALID(),
          [booking_id] UNIQUEIDENTIFIER NOT NULL,
          [user_id] NVARCHAR(100) NOT NULL,
          [recipient_email] NVARCHAR(255) NOT NULL,
          [reminder_type] NVARCHAR(20) NOT NULL,
          [scheduled_at] DATETIME2(0) NOT NULL,
          [reminder_status] NVARCHAR(20) NOT NULL DEFAULT 'INACTIVE',
          [idempotency_key] NVARCHAR(255) NOT NULL,
          [is_active] BIT NOT NULL DEFAULT 0,
          [activated_at] DATETIME2(0) NULL,
          [sent_at] DATETIME2(0) NULL,
          [created_at] DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
          [updated_at] DATETIME2(0) NOT NULL DEFAULT SYSUTCDATETIME(),
          CONSTRAINT [PK_reminders_id] PRIMARY KEY CLUSTERED ([id]),
          CONSTRAINT [UQ_reminders_booking_reminder_type] UNIQUE NONCLUSTERED ([booking_id], [reminder_type]),
          CONSTRAINT [UQ_reminders_idempotency_key] UNIQUE NONCLUSTERED ([idempotency_key])
        );
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_reminders_sweep' AND object_id = OBJECT_ID('reminders'))
      BEGIN
        CREATE NONCLUSTERED INDEX [IX_reminders_sweep] 
        ON [reminders] ([is_active], [reminder_status], [scheduled_at]);
      END
    `);

    await queryRunner.query(`
      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_reminders_booking_id' AND object_id = OBJECT_ID('reminders'))
      BEGIN
        CREATE NONCLUSTERED INDEX [IX_reminders_booking_id] 
        ON [reminders] ([booking_id]);
      END
    `);
  }

  /**
   * Revert migration
   * @param {import('typeorm').QueryRunner} queryRunner
   */
  async down(queryRunner) {
    // Drop reminders
    await queryRunner.query(`
      IF EXISTS (SELECT * FROM sys.tables WHERE name = 'reminders')
      BEGIN
        DROP TABLE [reminders];
      END
    `);

    // Drop notification_delivery_logs
    await queryRunner.query(`
      IF EXISTS (SELECT * FROM sys.tables WHERE name = 'notification_delivery_logs')
      BEGIN
        DROP TABLE [notification_delivery_logs];
      END
    `);

    // Drop notifications
    await queryRunner.query(`
      IF EXISTS (SELECT * FROM sys.tables WHERE name = 'notifications')
      BEGIN
        DROP TABLE [notifications];
      END
    `);

    // Drop processed_events
    await queryRunner.query(`
      IF EXISTS (SELECT * FROM sys.tables WHERE name = 'processed_events')
      BEGIN
        DROP TABLE [processed_events];
      END
    `);
  }
}

module.exports = InitialNotificationSchema1700000000001;
