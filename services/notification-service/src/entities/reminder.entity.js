const { EntitySchema } = require('typeorm');
const { REMINDER_STATUS } = require('../constants/reminder-status');

/**
 * Reminder Entity Schema for TypeORM (CommonJS)
 * Autonomous local state for scheduling arrival and departure reminders
 */
module.exports = new EntitySchema({
  name: 'Reminder',
  tableName: 'reminders',
  columns: {
    id: {
      primary: true,
      type: 'uniqueidentifier',
      generated: 'uuid'
    },
    bookingId: {
      name: 'booking_id',
      type: 'uniqueidentifier',
      nullable: false
    },
    userId: {
      name: 'user_id',
      type: 'nvarchar',
      length: 100,
      nullable: false
    },
    recipientEmail: {
      name: 'recipient_email',
      type: 'nvarchar',
      length: 255,
      nullable: false
    },
    reminderType: {
      name: 'reminder_type',
      type: 'nvarchar',
      length: 20,
      nullable: false
    },
    scheduledAt: {
      name: 'scheduled_at',
      type: 'datetime2',
      precision: 0,
      nullable: false
    },
    nextAttemptAt: {
      name: 'next_attempt_at',
      type: 'datetime2',
      precision: 0,
      nullable: true
    },
    reminderStatus: {
      name: 'reminder_status',
      type: 'nvarchar',
      length: 20,
      nullable: false,
      default: REMINDER_STATUS.INACTIVE
    },
    idempotencyKey: {
      name: 'idempotency_key',
      type: 'nvarchar',
      length: 255,
      unique: true,
      nullable: false
    },
    isActive: {
      name: 'is_active',
      type: 'bit',
      nullable: false,
      default: false
    },
    activatedAt: {
      name: 'activated_at',
      type: 'datetime2',
      precision: 0,
      nullable: true
    },
    sentAt: {
      name: 'sent_at',
      type: 'datetime2',
      precision: 0,
      nullable: true
    },
    payload: {
      name: 'payload',
      type: 'nvarchar',
      length: 'MAX',
      nullable: true
    },
    retryCount: {
      name: 'retry_count',
      type: 'int',
      nullable: false,
      default: 0
    },
    lastError: {
      name: 'last_error',
      type: 'nvarchar',
      length: 'MAX',
      nullable: true
    },
    claimOwner: {
      name: 'claim_owner',
      type: 'nvarchar',
      length: 100,
      nullable: true
    },
    claimExpiresAt: {
      name: 'claim_expires_at',
      type: 'datetime2',
      precision: 0,
      nullable: true
    },
    claimVersion: {
      name: 'claim_version',
      type: 'int',
      nullable: false,
      default: 0
    },
    createdAt: {
      name: 'created_at',
      type: 'datetime2',
      precision: 0,
      createDate: true,
      default: () => 'SYSUTCDATETIME()'
    },
    updatedAt: {
      name: 'updated_at',
      type: 'datetime2',
      precision: 0,
      updateDate: true,
      default: () => 'SYSUTCDATETIME()'
    }
  },
  indices: [
    {
      name: 'UQ_reminders_booking_reminder_type',
      unique: true,
      columns: ['bookingId', 'reminderType']
    },
    {
      name: 'UQ_reminders_idempotency_key',
      unique: true,
      columns: ['idempotencyKey']
    },
    {
      name: 'IX_reminders_sweep',
      columns: ['isActive', 'reminderStatus', 'scheduledAt']
    },
    {
      name: 'IX_reminders_sweep_v2',
      columns: ['isActive', 'reminderStatus', 'scheduledAt', 'nextAttemptAt']
    },
    {
      name: 'IX_reminders_booking_id',
      columns: ['bookingId']
    }
  ]
});
