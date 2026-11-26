const { EntitySchema } = require('typeorm');

/**
 * NotificationDeliveryLog Entity Schema for TypeORM (CommonJS)
 * Fine-grained audit trail capturing each email dispatch attempt and provider responses
 */
module.exports = new EntitySchema({
  name: 'NotificationDeliveryLog',
  tableName: 'notification_delivery_logs',
  columns: {
    id: {
      primary: true,
      type: 'uniqueidentifier',
      generated: 'uuid'
    },
    notificationId: {
      name: 'notification_id',
      type: 'uniqueidentifier',
      nullable: false
    },
    attemptNumber: {
      name: 'attempt_number',
      type: 'int',
      nullable: false
    },
    provider: {
      name: 'provider',
      type: 'nvarchar',
      length: 50,
      nullable: false,
      default: 'SMTP'
    },
    deliveryStatus: {
      name: 'delivery_status',
      type: 'nvarchar',
      length: 20,
      nullable: false
    },
    attemptedAt: {
      name: 'attempted_at',
      type: 'datetime2',
      precision: 0,
      createDate: true,
      default: () => 'SYSUTCDATETIME()'
    },
    completedAt: {
      name: 'completed_at',
      type: 'datetime2',
      precision: 0,
      nullable: true
    },
    errorMessage: {
      name: 'error_message',
      type: 'nvarchar',
      length: 'MAX',
      nullable: true
    },
    providerMessageId: {
      name: 'provider_message_id',
      type: 'nvarchar',
      length: 255,
      nullable: true
    }
  },
  relations: {
    notification: {
      target: 'Notification',
      type: 'many-to-one',
      joinColumn: {
        name: 'notification_id',
        referencedColumnName: 'id'
      },
      onDelete: 'CASCADE'
    }
  },
  indices: [
    {
      name: 'IX_delivery_logs_notification_id',
      columns: ['notificationId']
    },
    {
      name: 'IX_delivery_logs_delivery_status',
      columns: ['deliveryStatus']
    }
  ]
});
