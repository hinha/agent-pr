const logger = require('./src/utils/logger');
const scheduler = require('./src/services/schedulerDaemon');

// Keep process alive on uncaught errors to prevent repeated restarts
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}. Continuing operation.`);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled rejection at ${promise}: reason: ${reason}. Continuing operation.`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down PR monitor');
  scheduler.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down PR monitor');
  scheduler.stop();
  process.exit(0);
});

// Start the daemon
scheduler.start();
