#!/usr/bin/env node

/**
 * Standalone runner for Notification Service Reminder Sweeper
 * Usage: npm run sweeper:start
 */
require('dotenv').config();
const AppDataSource = require('../src/config/data-source');
const { ReminderSweeperService } = require('../src/services/reminder-sweeper.service');

async function bootstrap() {
  console.log('====================================================');
  console.log('Starting ParkEase Notification Service Reminder Sweeper');
  console.log('====================================================');

  try {
    // 1. Initialize Database Connection
    if (!AppDataSource.isInitialized) {
      console.log('[Bootstrap] Initializing database connection...');
      await AppDataSource.initialize();
      console.log(`[Bootstrap] Connected to database: ${AppDataSource.options.database}`);
    }

    // 2. Start Reminder Sweeper
    const sweeper = new ReminderSweeperService({ dataSource: AppDataSource });
    sweeper.start();

    // 3. Graceful Shutdown Hooks
    const handleShutdown = async (signal) => {
      console.log(`\n[Shutdown] Received ${signal}. Shutting down sweeper gracefully...`);
      await sweeper.stop();
      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
      console.log('[Shutdown] All connections closed. Exiting.');
      process.exit(0);
    };

    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  } catch (error) {
    console.error('[Bootstrap Error] Failed to start sweeper:', error.message);
    process.exit(1);
  }
}

bootstrap();
