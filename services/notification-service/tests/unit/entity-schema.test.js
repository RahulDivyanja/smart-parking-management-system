const { describe, it } = require('node:test');
const assert = require('node:assert');

const NotificationEntity = require('../../src/entities/notification.entity');
const NotificationDeliveryLogEntity = require('../../src/entities/notification-delivery-log.entity');
const ProcessedEventEntity = require('../../src/entities/processed-event.entity');
const ReminderEntity = require('../../src/entities/reminder.entity');

const { NOTIFICATION_TYPE } = require('../../src/constants/notification-type');
const { DELIVERY_STATUS } = require('../../src/constants/delivery-status');
const { REMINDER_STATUS } = require('../../src/constants/reminder-status');
const { REMINDER_TYPE } = require('../../src/constants/reminder-type');
const { PROCESSING_STATUS } = require('../../src/constants/processing-status');

describe('Notification Service - Entity Schemas Unit Tests', () => {

  describe('Notification Entity Schema', () => {
    it('should define correct table name and primary key', () => {
      assert.strictEqual(NotificationEntity.options.tableName, 'notifications');
      const idCol = NotificationEntity.options.columns.id;
      assert.ok(idCol);
      assert.strictEqual(idCol.primary, true);
      assert.strictEqual(idCol.type, 'uniqueidentifier');
      assert.strictEqual(idCol.generated, 'uuid');
    });

    it('should define required audit and dispatch columns with proper types', () => {
      const cols = NotificationEntity.options.columns;
      assert.strictEqual(cols.recipientEmail.name, 'recipient_email');
      assert.strictEqual(cols.recipientEmail.nullable, false);
      assert.strictEqual(cols.notificationType.name, 'notification_type');
      assert.strictEqual(cols.notificationType.nullable, false);
      assert.strictEqual(cols.subject.name, 'subject');
      assert.strictEqual(cols.subject.nullable, false);
      assert.strictEqual(cols.templateName.name, 'template_name');
      assert.strictEqual(cols.templateName.nullable, false);
      assert.strictEqual(cols.deliveryStatus.name, 'delivery_status');
      assert.strictEqual(cols.deliveryStatus.default, DELIVERY_STATUS.PENDING);
    });

    it('should define relations to NotificationDeliveryLog with cascade', () => {
      const relations = NotificationEntity.options.relations;
      assert.ok(relations.deliveryLogs);
      assert.strictEqual(relations.deliveryLogs.type, 'one-to-many');
      assert.strictEqual(relations.deliveryLogs.target, 'NotificationDeliveryLog');
      assert.strictEqual(relations.deliveryLogs.cascade, true);
    });

    it('should define unique index on idempotencyKey', () => {
      const indices = NotificationEntity.options.indices;
      const idempotencyIndex = indices.find(idx => idx.name === 'UQ_notifications_idempotency_key');
      assert.ok(idempotencyIndex, 'Missing UQ_notifications_idempotency_key index');
      assert.strictEqual(idempotencyIndex.unique, true);
      assert.deepStrictEqual(idempotencyIndex.columns, ['idempotencyKey']);
    });
  });

  describe('NotificationDeliveryLog Entity Schema', () => {
    it('should define correct table name and primary key', () => {
      assert.strictEqual(NotificationDeliveryLogEntity.options.tableName, 'notification_delivery_logs');
      const idCol = NotificationDeliveryLogEntity.options.columns.id;
      assert.ok(idCol);
      assert.strictEqual(idCol.primary, true);
      assert.strictEqual(idCol.type, 'uniqueidentifier');
    });

    it('should define foreign key relationship to Notification with CASCADE delete', () => {
      const relations = NotificationDeliveryLogEntity.options.relations;
      assert.ok(relations.notification);
      assert.strictEqual(relations.notification.type, 'many-to-one');
      assert.strictEqual(relations.notification.target, 'Notification');
      assert.strictEqual(relations.notification.joinColumn.name, 'notification_id');
      assert.strictEqual(relations.notification.onDelete, 'CASCADE');
    });

    it('should define required audit fields', () => {
      const cols = NotificationDeliveryLogEntity.options.columns;
      assert.strictEqual(cols.attemptNumber.name, 'attempt_number');
      assert.strictEqual(cols.attemptNumber.type, 'int');
      assert.strictEqual(cols.provider.default, 'SMTP');
      assert.strictEqual(cols.deliveryStatus.name, 'delivery_status');
    });
  });

  describe('ProcessedEvent Entity Schema', () => {
    it('should define correct table name and primary key', () => {
      assert.strictEqual(ProcessedEventEntity.options.tableName, 'processed_events');
      const idCol = ProcessedEventEntity.options.columns.id;
      assert.ok(idCol);
      assert.strictEqual(idCol.primary, true);
      assert.strictEqual(idCol.type, 'uniqueidentifier');
    });

    it('should enforce unique eventId for idempotency', () => {
      const eventIdCol = ProcessedEventEntity.options.columns.eventId;
      assert.strictEqual(eventIdCol.name, 'event_id');
      assert.strictEqual(eventIdCol.unique, true);
      assert.strictEqual(eventIdCol.nullable, false);

      const indices = ProcessedEventEntity.options.indices;
      const eventIdIdx = indices.find(idx => idx.name === 'UQ_processed_events_event_id');
      assert.ok(eventIdIdx);
      assert.strictEqual(eventIdIdx.unique, true);
    });

    it('should have default processingStatus of RECEIVED', () => {
      const statusCol = ProcessedEventEntity.options.columns.processingStatus;
      assert.strictEqual(statusCol.default, PROCESSING_STATUS.RECEIVED);
    });
  });

  describe('Reminder Entity Schema', () => {
    it('should define correct table name and primary key', () => {
      assert.strictEqual(ReminderEntity.options.tableName, 'reminders');
      const idCol = ReminderEntity.options.columns.id;
      assert.ok(idCol);
      assert.strictEqual(idCol.primary, true);
      assert.strictEqual(idCol.type, 'uniqueidentifier');
    });

    it('should initially be INACTIVE and inactive by default', () => {
      const statusCol = ReminderEntity.options.columns.reminderStatus;
      assert.strictEqual(statusCol.default, REMINDER_STATUS.INACTIVE);

      const isActiveCol = ReminderEntity.options.columns.isActive;
      assert.strictEqual(isActiveCol.default, false);
    });

    it('should define unique compound constraint on bookingId and reminderType', () => {
      const indices = ReminderEntity.options.indices;
      const compoundIdx = indices.find(idx => idx.name === 'UQ_reminders_booking_reminder_type');
      assert.ok(compoundIdx, 'Missing compound unique index on bookingId and reminderType');
      assert.strictEqual(compoundIdx.unique, true);
      assert.deepStrictEqual(compoundIdx.columns, ['bookingId', 'reminderType']);
    });

    it('should define unique index on idempotencyKey', () => {
      const indices = ReminderEntity.options.indices;
      const idempotencyIdx = indices.find(idx => idx.name === 'UQ_reminders_idempotency_key');
      assert.ok(idempotencyIdx);
      assert.strictEqual(idempotencyIdx.unique, true);
    });
  });

  describe('Constants and Enums Integrity', () => {
    it('should verify all NOTIFICATION_TYPE members', () => {
      assert.strictEqual(NOTIFICATION_TYPE.BOOKING_CREATED, 'BOOKING_CREATED');
      assert.strictEqual(NOTIFICATION_TYPE.BOOKING_CONFIRMED, 'BOOKING_CONFIRMED');
      assert.strictEqual(NOTIFICATION_TYPE.BOOKING_CANCELLED, 'BOOKING_CANCELLED');
      assert.strictEqual(NOTIFICATION_TYPE.BOOKING_EXPIRED, 'BOOKING_EXPIRED');
      assert.strictEqual(NOTIFICATION_TYPE.REMINDER_ARRIVAL, 'REMINDER_ARRIVAL');
      assert.strictEqual(NOTIFICATION_TYPE.REMINDER_DEPARTURE, 'REMINDER_DEPARTURE');
    });

    it('should verify REMINDER_STATUS and REMINDER_TYPE members', () => {
      assert.strictEqual(REMINDER_STATUS.INACTIVE, 'INACTIVE');
      assert.strictEqual(REMINDER_STATUS.PENDING, 'PENDING');
      assert.strictEqual(REMINDER_STATUS.SENT, 'SENT');
      assert.strictEqual(REMINDER_STATUS.CANCELLED, 'CANCELLED');
      assert.strictEqual(REMINDER_STATUS.SKIPPED, 'SKIPPED');

      assert.strictEqual(REMINDER_TYPE.ARRIVAL, 'ARRIVAL');
      assert.strictEqual(REMINDER_TYPE.DEPARTURE, 'DEPARTURE');
    });

    it('should verify PROCESSING_STATUS and DELIVERY_STATUS members', () => {
      assert.strictEqual(PROCESSING_STATUS.RECEIVED, 'RECEIVED');
      assert.strictEqual(PROCESSING_STATUS.PERSISTED, 'PERSISTED');
      assert.strictEqual(PROCESSING_STATUS.COMPLETED, 'COMPLETED');
      assert.strictEqual(PROCESSING_STATUS.FAILED, 'FAILED');

      assert.strictEqual(DELIVERY_STATUS.PENDING, 'PENDING');
      assert.strictEqual(DELIVERY_STATUS.SENDING, 'SENDING');
      assert.strictEqual(DELIVERY_STATUS.SENT, 'SENT');
      assert.strictEqual(DELIVERY_STATUS.FAILED, 'FAILED');
      assert.strictEqual(DELIVERY_STATUS.RETRYING, 'RETRYING');
    });
  });
});
