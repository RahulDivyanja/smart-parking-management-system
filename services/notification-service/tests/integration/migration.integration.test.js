const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { DataSource } = require('typeorm');

const NotificationEntity = require('../../src/entities/notification.entity');
const NotificationDeliveryLogEntity = require('../../src/entities/notification-delivery-log.entity');
const ProcessedEventEntity = require('../../src/entities/processed-event.entity');
const ReminderEntity = require('../../src/entities/reminder.entity');
const config = require('../../src/config/env');

const TEST_DB_NAME = 'ParkEase_NotificationDB_Test';

describe('Notification Service - Live Migration Integration Tests', () => {
  let testDataSource;

  before(async () => {
    testDataSource = new DataSource({
      type: 'mssql',
      host: config.db.host,
      port: config.db.port,
      username: config.db.username,
      password: config.db.password,
      database: TEST_DB_NAME,
      entities: [
        NotificationEntity,
        NotificationDeliveryLogEntity,
        ProcessedEventEntity,
        ReminderEntity
      ],
      migrations: [path.join(__dirname, '../../src/migrations/*{.ts,.js}')],
      synchronize: false,
      logging: false,
      options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        useUTC: true
      },
      extra: {
        connectionTimeout: 15000,
        requestTimeout: 15000
      }
    });

    await testDataSource.initialize();

    // Verify connected database safety guardrail
    const dbCheck = await testDataSource.query('SELECT DB_NAME() AS currentDb');
    assert.strictEqual(
      dbCheck[0].currentDb,
      TEST_DB_NAME,
      `Safety violation: Connected to ${dbCheck[0].currentDb} instead of ${TEST_DB_NAME}`
    );

    // Run migration
    await testDataSource.runMigrations();
  });

  after(async () => {
    if (testDataSource && testDataSource.isInitialized) {
      await testDataSource.destroy();
    }
  });

  it('should verify all 4 tables exist in the database', async () => {
    const tables = await testDataSource.query(`
      SELECT TABLE_NAME 
      FROM INFORMATION_SCHEMA.TABLES 
      WHERE TABLE_TYPE = 'BASE TABLE'
    `);
    const tableNames = tables.map(t => t.TABLE_NAME);

    assert.ok(tableNames.includes('notifications'), 'Missing notifications table');
    assert.ok(tableNames.includes('notification_delivery_logs'), 'Missing notification_delivery_logs table');
    assert.ok(tableNames.includes('processed_events'), 'Missing processed_events table');
    assert.ok(tableNames.includes('reminders'), 'Missing reminders table');
  });

  it('should enforce unique constraint on processed_events(event_id)', async () => {
    const indexes = await testDataSource.query(`
      SELECT name, is_unique 
      FROM sys.indexes 
      WHERE object_id = OBJECT_ID('processed_events') 
        AND name = 'UQ_processed_events_event_id'
    `);
    assert.strictEqual(indexes.length, 1);
    assert.strictEqual(indexes[0].is_unique, true);
  });

  it('should enforce compound unique constraint on reminders(booking_id, reminder_type)', async () => {
    const indexes = await testDataSource.query(`
      SELECT i.name, i.is_unique, c.name AS columnName, ic.key_ordinal
      FROM sys.indexes i
      JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
      JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
      WHERE i.object_id = OBJECT_ID('reminders') 
        AND i.name = 'UQ_reminders_booking_reminder_type'
      ORDER BY ic.key_ordinal
    `);
    assert.strictEqual(indexes.length, 2);
    assert.strictEqual(indexes[0].is_unique, true);
    assert.strictEqual(indexes[0].columnName, 'booking_id');
    assert.strictEqual(indexes[1].columnName, 'reminder_type');
  });

  it('should enforce unique constraint on reminders(idempotency_key)', async () => {
    const indexes = await testDataSource.query(`
      SELECT name, is_unique 
      FROM sys.indexes 
      WHERE object_id = OBJECT_ID('reminders') 
        AND name = 'UQ_reminders_idempotency_key'
    `);
    assert.strictEqual(indexes.length, 1);
    assert.strictEqual(indexes[0].is_unique, true);
  });

  it('should verify foreign key from notification_delivery_logs to notifications with CASCADE delete', async () => {
    const fk = await testDataSource.query(`
      SELECT 
        fk.name AS fk_name,
        delete_referential_action_desc
      FROM sys.foreign_keys fk
      WHERE fk.name = 'FK_delivery_logs_notification'
    `);
    assert.strictEqual(fk.length, 1);
    assert.strictEqual(fk[0].delete_referential_action_desc, 'CASCADE');
  });

  it('should safely insert and cascade delete notification records', async () => {
    const notifRepo = testDataSource.getRepository('Notification');
    const logRepo = testDataSource.getRepository('NotificationDeliveryLog');

    const testNotif = await notifRepo.save({
      recipientEmail: 'test-user@parkease.test',
      notificationType: 'BOOKING_CREATED',
      subject: 'Reservation Created',
      templateName: 'booking-created',
      payload: JSON.stringify({ bookingId: 'b-123' }),
      deliveryStatus: 'PENDING'
    });

    assert.ok(testNotif.id);

    const testLog = await logRepo.save({
      notificationId: testNotif.id,
      attemptNumber: 1,
      provider: 'SMTP',
      deliveryStatus: 'SUCCESS',
      providerMessageId: 'msg-001'
    });

    assert.ok(testLog.id);

    // Verify cascade delete
    await notifRepo.delete(testNotif.id);

    const foundLog = await logRepo.findOneBy({ id: testLog.id });
    assert.strictEqual(foundLog, null, 'Delivery log should have been cascade deleted');
  });

  it('should reject duplicate (booking_id, reminder_type) in reminders table', async () => {
    const reminderRepo = testDataSource.getRepository('Reminder');
    const testBookingId = '11111111-1111-1111-1111-111111111111';

    await reminderRepo.save({
      bookingId: testBookingId,
      userId: 'user-001',
      recipientEmail: 'driver@parkease.test',
      reminderType: 'ARRIVAL',
      scheduledAt: new Date(Date.now() + 3600000),
      reminderStatus: 'INACTIVE',
      idempotencyKey: 'TEST_REMINDER_1',
      isActive: false
    });

    await assert.rejects(
      async () => {
        await reminderRepo.save({
          bookingId: testBookingId,
          userId: 'user-001',
          recipientEmail: 'driver@parkease.test',
          reminderType: 'ARRIVAL', // Duplicate type for same booking
          scheduledAt: new Date(Date.now() + 3600000),
          reminderStatus: 'INACTIVE',
          idempotencyKey: 'TEST_REMINDER_2',
          isActive: false
        });
      },
      /Violation of UNIQUE KEY constraint/
    );

    // Clean up test reminder
    await reminderRepo.delete({ bookingId: testBookingId });
  });
});
