const { EntitySchema } = require('typeorm');
const { BOOKING_STATUS } = require('../constants/booking-status');

/**
 * Booking Entity Schema for TypeORM (CommonJS)
 * Maps to Microsoft SQL Server 'bookings' table
 */
module.exports = new EntitySchema({
  name: 'Booking',
  tableName: 'bookings',
  columns: {
    id: {
      primary: true,
      type: 'uniqueidentifier',
      generated: 'uuid'
    },
    bookingReference: {
      name: 'booking_reference',
      type: 'nvarchar',
      length: 25,
      unique: true,
      nullable: false
    },
    userId: {
      name: 'user_id',
      type: 'nvarchar',
      length: 50,
      nullable: false
    },
    facilityId: {
      name: 'facility_id',
      type: 'nvarchar',
      length: 50,
      nullable: false
    },
    vehicleRegistrationNumber: {
      name: 'vehicle_registration_number',
      type: 'nvarchar',
      length: 20,
      nullable: false
    },
    startTime: {
      name: 'start_time',
      type: 'datetime2',
      precision: 0,
      nullable: false
    },
    endTime: {
      name: 'end_time',
      type: 'datetime2',
      precision: 0,
      nullable: false
    },
    hourlyRate: {
      name: 'hourly_rate',
      type: 'decimal',
      precision: 10,
      scale: 2,
      nullable: false
    },
    totalAmount: {
      name: 'total_amount',
      type: 'decimal',
      precision: 10,
      scale: 2,
      nullable: false
    },
    status: {
      type: 'nvarchar',
      length: 20,
      default: BOOKING_STATUS.PENDING,
      nullable: false
    },
    createdAt: {
      name: 'created_at',
      type: 'datetime2',
      precision: 0,
      createDate: true
    },
    updatedAt: {
      name: 'updated_at',
      type: 'datetime2',
      precision: 0,
      updateDate: true
    }
  },
  indices: [
    {
      name: 'IX_bookings_facility_status_times',
      columns: ['facilityId', 'status', 'startTime', 'endTime']
    },
    {
      name: 'IX_bookings_user_id',
      columns: ['userId']
    },
    {
      name: 'IX_bookings_booking_reference',
      columns: ['bookingReference'],
      unique: true
    }
  ]
});
