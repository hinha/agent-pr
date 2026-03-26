#!/usr/bin/env node
const logger = require('./src/utils/logger');
const MemoryMonitor = require('./src/utils/memoryMonitor');
const scheduler = require('./src/services/schedulerDaemon');
const telegramService = require('./src/services/telegramService');

let memoryMonitor;

// Keep process alive on uncaught errors to prevent repeated restarts
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err.message}. Continuing operation.`);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`Unhandled rejection at ${promise}: reason: ${reason}. Continuing operation.`);
});

/**
 * Graceful shutdown handler
 * Ensures all resources are properly cleaned up before exit
 */
async function gracefulShutdown() {
  logger.info('Starting graceful shutdown...');

  // 0. Stop memory monitor first
  if (memoryMonitor) {
    memoryMonitor.stop();
    logger.info('Memory monitor stopped');
  }

  // 1. Stop accepting new work
  if (scheduler) {
    await scheduler.stop();
    logger.info('Scheduler stopped');
  }

  // 2. Stop Telegram polling
  if (telegramService) {
    await telegramService.stop();
    logger.info('Telegram service stopped');
  }

  // 3. Wait for pending operations (with timeout)
  const shutdownTimeout = setTimeout(() => {
    logger.warn('Shutdown timeout, forcing exit...');
    process.exit(1);
  }, 30000);
  shutdownTimeout.unref();

  try {
    // Wait for active processes to complete
    if (scheduler) {
      const completed = await scheduler.waitForCompletion(30000);
      if (completed) {
        logger.info('All active PR processes completed');
      } else {
        logger.warn('Some processes did not complete in time');
      }
    }
  } finally {
    clearTimeout(shutdownTimeout);
  }

  logger.info('Graceful shutdown complete');
  process.exit(0);
}

// Handle graceful shutdown signals
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

/**
 * Start memory monitoring with 128MB limit
 * Monitors memory usage and takes action at three thresholds:
 * - Warning (70%): Log elevated memory usage
 * - Critical (85%): Trigger garbage collection
 * - Restart (95%): Trigger graceful shutdown for auto-restart
 */
function startMemoryMonitor() {
  memoryMonitor = new MemoryMonitor({
    memoryLimit: 128 * 1024 * 1024, // 128MB
    intervalMs: 60 * 1000, // Check every minute
    onCritical: (reason, usage) => {
      if (reason === 'restart required') {
        logger.error('Auto-restart triggered due to memory limit', {
          heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
          limit: '128MB'
        });
        gracefulShutdown();
      }
    }
  });
  memoryMonitor.start();
}

// Start the daemon
logger.info('Starting PR monitor daemon...');
scheduler.start();

// Start memory monitoring
startMemoryMonitor();
logger.info('Daemon started successfully');
