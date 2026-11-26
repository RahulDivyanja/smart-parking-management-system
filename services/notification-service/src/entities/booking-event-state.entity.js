const { EntitySchema } = require('typeorm');

/**
 * Booking Event State Entity Schema for TypeORM (CommonJS)
 * Local state tracker to resolve out-of-order and concurrent booking lifecycle events
 */
module.exports = new EntitySchema({
  name: 'BookingEventState',
  tableName: 'booking_event_states',
  columns: {
    bookingId: {
      name: 'booking_id',
      type: 'uniqueidentifier',
      primary: true
    },
    bookingReference: {
      name: 'booking_reference',
      type: 'nvarchar',
      length: 100,
      nullable: true
    },
    userId: {
      name: 'user_id',
      type: 'nvarchar',
      length: 100,
      nullable: false
    },
    facilityId: {
      name: 'facility_id',
      type: 'nvarchar',
      length: 50,
      nullable: true
    },
    currentStatus: {
      name: 'current_status',
      type: 'nvarchar',
      length: 50,
      nullable: false
    },
    hasCreatedEvent: {
      name: 'has_created_event',
      type: 'bit',
      nullable: false,
      default: false
    },
    startTime: {
      name: 'start_time',
      type: 'datetime2',
      precision: 0,
      nullable: true
    },
    endTime: {
      name: 'end_time',
      type: 'datetime2',
      precision: 0,
      nullable: true
    },
    statusUpdatedAt: {
      name: 'status_updated_at',
      type: 'datetime2',
      precision: 0,
      nullable: false,
      default: () => 'SYSUTCDATETIME()'
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
      name: 'IX_booking_event_states_status',
      columns: ['currentStatus']
    }
  ]
});
