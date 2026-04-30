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
    this._callbackQueryHandler = null; // Store for cleanup
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

      // Remove Telegram callback handler before stopping bot
      const telegramAdapter = this.container.get('telegramAdapter');
      if (this._callbackQueryHandler) {
        telegramAdapter.off('callback_query', this._callbackQueryHandler);
        this._callbackQueryHandler = null;
        logger.info('   ✓ Telegram callback handlers removed');
      }

      // Stop Telegram bot
      await telegramAdapter.stop();
      logger.info('   ✓ Telegram bot stopped');

      // Stop Flagsmith sync
      const flagsmithSyncService = this.container.get('flagsmithSyncService');
      flagsmithSyncService.stop();
      logger.info('   ✓ Flagsmith sync stopped');

      // Emit application stopped event (before clearing listeners)
      const eventBus = this.container.get('eventBus');

      await eventBus.emitAsync('application.stopped', {
        stopTime: new Date()
      });

      eventBus.clear();
      logger.info('   ✓ EventBus cleared');

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
    const skipManager = this.container.get('skipManager');
    const stateRepositoryFactory = this.container.get('stateRepositoryFactory');
    const checkOutdatedReviewsUseCase = this.container.get('checkOutdatedReviewsUseCase');

    logger.info(`[Bootstrap] Setting up Telegram callbacks (isPollingOwner: ${telegramAdapter.isPollingOwner})`);

    // Get bot and chatId for CallbackHandler
    const bot = telegramAdapter.getBot();
    const chatId = telegramAdapter.chatId;

    // Update CallbackHandler with bot and dependencies
    callbackHandler.bot = bot;
    callbackHandler.chatId = chatId;
    callbackHandler.skipManager = skipManager;
    callbackHandler.stateRepositoryFactory = stateRepositoryFactory;
    callbackHandler.checkOutdatedReviewsUseCase = checkOutdatedReviewsUseCase;

    // Store handler for cleanup
    this._callbackQueryHandler = async (query) => {
      try {
        logger.info(`[Bootstrap] Processing callback: ${query.data}`);

        // Wrap raw query with helper methods that delegate to bot API
        const wrappedQuery = this._wrapCallbackQuery(query, bot, chatId);
        await callbackHandler.handleCallbackQuery(wrappedQuery, config);
      } catch (error) {
        logger.error(`Error handling callback query: ${error.message}`);

        // Answer the callback to prevent it from hanging
        try {
          await bot.answerCallbackQuery(query.id, { text: 'An error occurred', show_alert: true });
        } catch (answerError) {
          // Ignore answer errors
        }
      }
    };

    // Register callback handler
    telegramAdapter.on('callback_query', this._callbackQueryHandler);
  }

  /**
   * Wrap a raw Telegram callback query with helper methods
   * @private
   */
  _wrapCallbackQuery(query, bot, chatId) {
    return {
      ...query,
      message: query.message || {},
      answer: async (text, showAlert) => {
        const opts = {};
        if (text) opts.text = text;
        if (showAlert) opts.show_alert = true;
        return bot.answerCallbackQuery(query.id, opts);
      },
      editMessageText: async (text, options = {}) => {
        const msgId = query.message?.message_id;
        if (!msgId) return;
        return bot.editMessageText(text, {
          chat_id: chatId,
          message_id: msgId,
          parse_mode: 'HTML',
          ...options
        });
      },
      editMessageReplyMarkup: async (replyMarkup, options = {}) => {
        const msgId = query.message?.message_id;
        if (!msgId) return;
        return bot.editMessageReplyMarkup(replyMarkup, {
          chat_id: chatId,
          message_id: msgId,
          ...options
        });
      }
    };
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
