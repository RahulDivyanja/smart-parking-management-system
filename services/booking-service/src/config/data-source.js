require('reflect-metadata');
const { DataSource } = require('typeorm');
const path = require('path');
const config = require('./env');
const BookingEntity = require('../entities/booking.entity');

/**
 * TypeORM DataSource configuration for Microsoft SQL Server
 */
const AppDataSource = new DataSource({
  type: 'mssql',
  host: config.db.host,
  port: config.db.port,
  username: config.db.username,
  password: config.db.password,
  database: config.db.database,
  entities: [BookingEntity],
  migrations: [path.join(__dirname, '../migrations/*{.ts,.js}')],
  synchronize: config.db.synchronize,
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
