const app = require('./app');
const AppDataSource = require('./config/data-source');
const config = require('./config/env');
const expirationScheduler = require('./services/expiration-scheduler.service');

const PORT = config.port;

async function bootstrap() {
  try {
    console.log('[ParkEase Booking Service] Starting initialization...');

    // Initialize TypeORM MSSQL Database Connection
    try {
      await AppDataSource.initialize();
      console.log(`[Database] Successfully connected to Microsoft SQL Server (${config.db.host}:${config.db.port}/${config.db.database}).`);

      // Start the pending booking expiration scheduler only after DB is ready
      expirationScheduler.start();
    } catch (dbError) {
      console.warn(`[Database Warning] Could not connect to SQL Server (${dbError.message}).`);
      console.warn('[Database Warning] The service is running, but database-dependent operations will fail until MSSQL is reachable.');
    }

    // Start Express HTTP Server
    const server = app.listen(PORT, () => {
      console.log(`=======================================================`);
      console.log(` ParkEase Microservice 03: Booking Service is running!`);
      console.log(` Environment:  ${config.nodeEnv}`);
      console.log(` Port:         ${PORT}`);
      console.log(` Health Check: http://localhost:${PORT}/health`);
      console.log(` Swagger Docs: http://localhost:${PORT}/api-docs`);
      console.log(` OpenAPI Spec: http://localhost:${PORT}/api-docs.json`);
      console.log(`=======================================================`);
    });

    // Graceful shutdown handling
    const shutdown = async (signal) => {
      console.log(`\n[Shutdown] Received ${signal}. Shutting down gracefully...`);
      expirationScheduler.stop();

      server.close(() => {
        console.log('[Shutdown] HTTP server closed.');
      });

      if (AppDataSource.isInitialized) {
        await AppDataSource.destroy();
        console.log('[Shutdown] Database connection closed.');
      }

      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('[ParkEase Booking Service Fatal Error]:', error);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Unhandled Rejection at Promise]:', promise, 'reason:', reason);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[Uncaught Exception]:', error);
  process.exit(1);
});

bootstrap();
