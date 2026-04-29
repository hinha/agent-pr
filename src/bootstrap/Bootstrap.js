/**
 * Bootstrap - Application composition root and initialization
 *
 * This class handles the application startup sequence:
 * 1. Load configuration
 * 2. Initialize DI container
 * 3. Start Telegram bot
 * 4. Start PR processing orchestrator
 * 5. Set up graceful shutdown
 *
 * @example
 * const bootstrap = new Bootstrap();
 * await bootstrap.start();
 */

const container = require('../container/Container');
const MemoryMonitor = require('../utils/memoryMonitor');
const { getVersionInfo } = require('../shared/utils/version');

class Bootstrap {
  constructor() {
    this.container = container;
    this.memoryMonitor = null;
    this.isShuttingDown = false;
  }

  /**
   * Start the application
   *
   * @returns {Promise<void>}
   */
  async start() {
    const logger = this.container.get('logger');
    const config = this.container.get('config');

    try {
      // Get version info
      const versionInfo = getVersionInfo();

      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('   PR Monitor Daemon');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info(`   🏷️  Version: ${versionInfo.fullString}`);
      logger.info(`   📦 Node.js: ${process.version}`);
      logger.info(`   📅 Started: ${new Date().toISOString()}`);
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Set up error handlers for process stability
      this._setupErrorHandlers(logger);

      // Initialize Telegram bot
      const telegramAdapter = this.container.get('telegramAdapter');
      await telegramAdapter.start();
      logger.info('📱 Telegram bot started');

      // Register Telegram callback handler
      this._setupTelegramCallbacks(logger, config);

      // Start PR processing orchestrator
      const orchestrator = this.container.get('prProcessingOrchestrator');
      await orchestrator.start();
      logger.info('✅ PR processing orchestrator started');

      // Initialize Flagsmith sync if configured
      if (config.app?.flagsmith?.enabled) {
        const flagsmithSyncService = this.container.get('flagsmithSyncService');
        await flagsmithSyncService.init(config);
        if (config.app.flagsmith.syncIntervalMs) {
          flagsmithSyncService.start(config.app.flagsmith.syncIntervalMs);
        }
        logger.info('🔽 Flagsmith sync started');
      }

      // Start memory monitoring
      this._startMemoryMonitor(logger, config);

      // Set up graceful shutdown handlers
      this._setupShutdownHandlers();

      // Emit application started event
      const eventBus = this.container.get('eventBus');
      await eventBus.emitAsync('application.started', {
        startTime: new Date(),
        config: {
          instances: Object.keys(config.instances || {}).length,
          checkInterval: config.app.checkIntervalMs
        }
      });

      logger.info('✅ Application started successfully');
      logger.info(`📊 Monitoring ${Object.keys(config.instances || {}).length} instance(s)`);

      // Log instance and repo details
      for (const [instanceKey, instance] of Object.entries(config.instances || {})) {
        const repoCount = Object.keys(instance.repos || {}).length;
        logger.info(`   - ${instanceKey}: ${repoCount} repo(s)`);
      }

    } catch (error) {
      logger.error(`❌ Failed to start application: ${error.message}`);
      throw error;
    }
  }

  /**
   * Stop the application gracefully
   *
   * @returns {Promise<void>}
   */
  async stop() {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    const logger = this.container.get('logger');

    logger.info('🛑 Shutting down application...');

    try {
      // Stop memory monitor
      if (this.memoryMonitor) {
        this.memoryMonitor.stop();
        logger.info('   ✓ Memory monitor stopped');
      }

      // Stop PR processing orchestrator
      const orchestrator = this.container.get('prProcessingOrchestrator');
      await orchestrator.stop();
      logger.info('   ✓ PR processing orchestrator stopped');

      // Stop Telegram bot
      const telegramAdapter = this.container.get('telegramAdapter');
      await telegramAdapter.stop();
      logger.info('   ✓ Telegram bot stopped');

      // Stop Flagsmith sync
      const flagsmithSyncService = this.container.get('flagsmithSyncService');
      flagsmithSyncService.stop();
      logger.info('   ✓ Flagsmith sync stopped');

      // Emit application stopped event
      const eventBus = this.container.get('eventBus');
      await eventBus.emitAsync('application.stopped', {
        stopTime: new Date()
      });

      logger.info('✅ Application shutdown complete');

    } catch (error) {
      logger.error(`❌ Error during shutdown: ${error.message}`);
    }
  }

  /**
   * Set up process error handlers
   * @private
   */
  _setupErrorHandlers(logger) {
    process.on('uncaughtException', (err) => {
      logger.error(`Uncaught exception: ${err.message}. Continuing operation.`);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error(`Unhandled rejection at ${promise}: ${reason}. Continuing operation.`);
    });
  }

  /**
   * Set up Telegram callback handlers
   * @private
   */
  _setupTelegramCallbacks(logger, config) {
    const telegramAdapter = this.container.get('telegramAdapter');
    const callbackHandler = this.container.get('callbackHandler');

    // Register callback handler
    telegramAdapter.on('callback_query', async (query) => {
      try {
        await callbackHandler.handleCallbackQuery(query, config);
      } catch (error) {
        logger.error(`Error handling callback query: ${error.message}`);

        // Answer the callback to prevent it from hanging
        try {
          await query.answer('An error occurred', true);
        } catch (answerError) {
          // Ignore answer errors
        }
      }
    });

    logger.debug('Telegram callback handlers registered');
  }

  /**
   * Start memory monitoring
   * @private
   */
  _startMemoryMonitor(logger, config) {
    const memoryLimit = config.app?.memoryLimit || 128 * 1024 * 1024; // 128MB default

    this.memoryMonitor = new MemoryMonitor({
      memoryLimit,
      intervalMs: 60 * 1000, // Check every minute
      onCritical: (reason, usage) => {
        if (reason === 'restart required') {
          logger.error('Auto-restart triggered due to memory limit', {
            heapUsed: `${Math.round(usage.heapUsed / 1024 / 1024)}MB`,
            limit: `${Math.round(memoryLimit / 1024 / 1024)}MB`
          });

          // Trigger graceful shutdown
          this.stop().then(() => process.exit(0));
        }
      }
    });

    this.memoryMonitor.start();
    logger.info(`🧠 Memory monitor started (limit: ${Math.round(memoryLimit / 1024 / 1024)}MB)`);
  }

  /**
   * Set up graceful shutdown handlers
   * @private
   */
  _setupShutdownHandlers() {
    const shutdownHandler = async (signal) => {
      const logger = this.container.get('logger');
      logger.info(`Received ${signal}, initiating graceful shutdown...`);
      await this.stop();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
    process.on('SIGINT', () => shutdownHandler('SIGINT'));
  }

  /**
   * Get current application status
   *
   * @returns {Object} Application status
   */
  getStatus() {
    const orchestrator = this.container.get('prProcessingOrchestrator');
    const stats = orchestrator.getStats();

    return {
      isRunning: stats.isRunning,
      uptime: stats.uptime,
      isPolling: stats.isPolling,
      totalProcessed: stats.totalProcessed,
      totalNotified: stats.totalNotified,
      totalErrors: stats.totalErrors,
      lastPollTime: stats.lastPollTime,
      isShuttingDown: this.isShuttingDown
    };
  }

  /**
   * Get DI container (for testing/advanced usage)
   *
   * @returns {Object} DI container
   */
  getContainer() {
    return this.container;
  }
}

module.exports = Bootstrap;
