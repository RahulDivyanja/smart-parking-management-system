const app = require('./app');
const config = require('./config/env');

const PORT = config.port;

const server = app.listen(PORT, () => {
  console.log(`[NotificationService] Service running on port ${PORT} in ${config.nodeEnv} mode`);
});

const gracefulShutdown = () => {
  console.log('[NotificationService] Initiating graceful shutdown...');
  server.close(() => {
    console.log('[NotificationService] HTTP server closed.');
    process.exit(0);
  });
};

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

module.exports = server;
