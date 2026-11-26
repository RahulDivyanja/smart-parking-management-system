const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3005,
  nodeEnv: process.env.NODE_ENV || 'development',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT, 10) || 1433,
    database: process.env.DB_NAME || 'ParkEase_NotificationDB',
    username: process.env.DB_USER || 'ParkEaseAppUser',
    password: process.env.DB_PASSWORD || '',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
    synchronize: process.env.DB_SYNCHRONIZE === 'true',
    logging: process.env.DB_LOGGING === 'true'
  },
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672',
    exchange: process.env.RABBITMQ_EXCHANGE || 'parkease.events',
    queue: process.env.RABBITMQ_QUEUE || 'parkease.notifications.queue',
    retryExchange: process.env.RABBITMQ_RETRY_EXCHANGE || 'parkease.events.retry',
    retryQueue: process.env.RABBITMQ_RETRY_QUEUE || 'parkease.notifications.retry.queue',
    dlx: process.env.RABBITMQ_DLX || 'parkease.events.dlx',
    dlq: process.env.RABBITMQ_DLQ || 'parkease.notifications.dlq',
    retryLimit: parseInt(process.env.RABBITMQ_RETRY_LIMIT, 10) || 3,
    retryDelayMs: parseInt(process.env.RABBITMQ_RETRY_DELAY_MS, 10) || 5000,
    prefetch: parseInt(process.env.RABBITMQ_PREFETCH, 10) || 10
  },
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '',
    from: process.env.EMAIL_FROM || process.env.SMTP_USER || 'notifications@parkease.com',
    deliveryEnabled: process.env.EMAIL_DELIVERY_ENABLED === 'true'
  },
  services: {
    userServiceUrl: process.env.USER_SERVICE_URL || 'http://localhost:3001',
    userServiceEndpoint: process.env.USER_SERVICE_USER_ENDPOINT || '/api/v1/users/:userId',
    userServiceTimeout: parseInt(process.env.USER_SERVICE_TIMEOUT, 10) || 5000
  },
  sweeper: {
    intervalMs: parseInt(process.env.REMINDER_SWEEPER_INTERVAL_MS, 10) || 60000,
    batchSize: parseInt(process.env.REMINDER_SWEEPER_BATCH_SIZE, 10) || 20,
    leaseSeconds: parseInt(process.env.REMINDER_SWEEPER_LEASE_SECONDS, 10) || 60,
    maxAttempts: parseInt(process.env.REMINDER_SWEEPER_MAX_ATTEMPTS, 10) || 3,
    initialRetryDelayMs: parseInt(process.env.REMINDER_SWEEPER_RETRY_DELAY_MS, 10) || 60000
  }
};
