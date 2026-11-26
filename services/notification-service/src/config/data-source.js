require('reflect-metadata');
const { DataSource } = require('typeorm');
const path = require('path');
const config = require('./env');
const NotificationEntity = require('../entities/notification.entity');
const NotificationDeliveryLogEntity = require('../entities/notification-delivery-log.entity');
const ProcessedEventEntity = require('../entities/processed-event.entity');
const ReminderEntity = require('../entities/reminder.entity');
const BookingEventStateEntity = require('../entities/booking-event-state.entity');

/**
 * TypeORM DataSource configuration for Microsoft SQL Server
 * Exclusively manages ParkEase_NotificationDB
 */
const AppDataSource = new DataSource({
  type: 'mssql',
  host: config.db.host,
  port: config.db.port,
  username: config.db.username,
  password: config.db.password,
  database: config.db.database,
  entities: [
    NotificationEntity,
    NotificationDeliveryLogEntity,
    ProcessedEventEntity,
    ReminderEntity,
    BookingEventStateEntity
  ],
  migrations: [path.join(__dirname, '../migrations/*{.ts,.js}')],
  synchronize: false,
  logging: config.db.logging,
  options: {
    encrypt: false,
    trustServerCertificate: config.db.trustServerCertificate,
    enableArithAbort: true,
    useUTC: true
  },
  extra: {
    connectionTimeout: 15000,
    requestTimeout: 15000
  }
});

module.exports = AppDataSource;
