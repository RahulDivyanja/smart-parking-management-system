#!/usr/bin/env node

/**
 * Standalone runner for Notification Service RabbitMQ Consumer
 * Usage: npm run consumer:start
 */
require('dotenv').config();
const AppDataSource = require('../src/config/data-source');
const consumer = require('../src/consumers/notification.consumer');

async function bootstrap() {
  console.log('====================================================');
  console.log('Starting ParkEase Notification Service Event Consumer');
  console.log('====================================================');

  try {
    // 1. Initialize Database Connection
    if (!AppDataSource.isInitialized) {
      console.log('[Bootstrap] Initializing database connection...');
      await AppDataSource.initialize();
      console.log(`[Bootstrap] Connected to database: ${AppDataSource.options.database}`);
    }

    // 2. Start RabbitMQ Consumer
    await consumer.start();
    console.log('[Bootstrap] RabbitMQ Consumer running and waiting for messages.');

    // 3. Graceful Shutdown Hooks
    const handleShutdown = async (signal) => {
      console.log(`\n[Shutdown] Received ${signal}. Shutting down consumer gracefully...`);
      await consumer.stop();
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
      console.log('[Shutdown] All connections closed. Exiting.');
      process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  } catch (error) {
    console.error('[Bootstrap Error] Failed to start consumer:', error.message);
    process.exit(1);
  }
}

bootstrap();
