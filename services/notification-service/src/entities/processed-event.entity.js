const { EntitySchema } = require('typeorm');
const { PROCESSING_STATUS } = require('../constants/processing-status');

/**
 * ProcessedEvent Entity Schema for TypeORM (CommonJS)
 * Guarantees message consumption idempotency and tracks consumer ingestion history
 */
module.exports = new EntitySchema({
  name: 'ProcessedEvent',
  tableName: 'processed_events',
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
      unique: true,
      nullable: false
    },
    eventType: {
      name: 'event_type',
      type: 'nvarchar',
      length: 100,
      nullable: false
    },
    processingStatus: {
      name: 'processing_status',
      type: 'nvarchar',
      length: 20,
      nullable: false,
      default: PROCESSING_STATUS.RECEIVED
    },
    receivedAt: {
      name: 'received_at',
      type: 'datetime2',
      precision: 0,
      createDate: true,
      default: () => 'SYSUTCDATETIME()'
    },
    processedAt: {
      name: 'processed_at',
      type: 'datetime2',
      precision: 0,
      nullable: true
    },
    lastError: {
      name: 'last_error',
      type: 'nvarchar',
      length: 'MAX',
      nullable: true
    },
    retryCount: {
      name: 'retry_count',
      type: 'int',
      nullable: false,
      default: 0
    }
  },
  indices: [
    {
      name: 'UQ_processed_events_event_id',
      unique: true,
      columns: ['eventId']
    },
    {
      name: 'IX_processed_events_status',
      columns: ['processingStatus']
    }
  ]
});
