const { EntitySchema } = require('typeorm');
const { DELIVERY_STATUS } = require('../constants/delivery-status');

/**
 * Notification Entity Schema for TypeORM (CommonJS)
 * Represents the primary notification record and external delivery state
 */
module.exports = new EntitySchema({
  name: 'Notification',
  tableName: 'notifications',
  columns: {
    id: {
      primary: true,
      type: 'uniqueidentifier',
      generated: 'uuid'
    },
    eventId: {
      name: 'event_id',
      type: 'nvarchar',
      length: 100,
      nullable: true
    },
    idempotencyKey: {
      name: 'idempotency_key',
      type: 'nvarchar',
      length: 255,
      nullable: true
    },
    userId: {
      name: 'user_id',
      type: 'nvarchar',
      length: 100,
      nullable: true
    },
    recipientEmail: {
      name: 'recipient_email',
      type: 'nvarchar',
      length: 255,
      nullable: false
    },
    notificationType: {
      name: 'notification_type',
      type: 'nvarchar',
      length: 50,
      nullable: false
    },
    subject: {
      name: 'subject',
      type: 'nvarchar',
      length: 255,
      nullable: false
    },
    templateName: {
      name: 'template_name',
      type: 'nvarchar',
      length: 100,
      nullable: false
    },
    payload: {
      name: 'payload',
      type: 'nvarchar',
      length: 'MAX',
      nullable: true
    },
    deliveryStatus: {
      name: 'delivery_status',
      type: 'nvarchar',
      length: 20,
      nullable: false,
      default: DELIVERY_STATUS.PENDING
    },
    scheduledAt: {
      name: 'scheduled_at',
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
  relations: {
    deliveryLogs: {
      target: 'NotificationDeliveryLog',
      type: 'one-to-many',
      inverseSide: 'notification',
      cascade: true
    }
  },
  indices: [
    {
      name: 'UQ_notifications_idempotency_key',
      unique: true,
      columns: ['idempotencyKey'],
      where: 'idempotency_key IS NOT NULL'
    },
    {
      name: 'IX_notifications_recipient_email',
      columns: ['recipientEmail']
    },
    {
      name: 'IX_notifications_delivery_status',
      columns: ['deliveryStatus']
    },
    {
      name: 'IX_notifications_created_at',
      columns: ['createdAt']
    }
  ]
});
