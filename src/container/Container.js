const awilix = require('awilix');
const LoggerFactory = require('../shared/logging/LoggerFactory');
const RetryHelper = require('../shared/utils/RetryHelper');
const ErrorHandler = require('../shared/errors/ErrorHandler');
const { ConfigurationError } = require('../shared/errors');

/**
 * DI Container - Dependency Injection Container using Awilix
 *
 * This container manages all service dependencies and lifecycles.
 * It provides a central point for configuring and resolving services.
 *
 * Lifecycles:
 * - SINGLETON: One instance for the entire application lifetime
 * - SCOPED: One instance per scope (e.g., per request)
 * - TRANSIENT: New instance created each time
 *
 * @example
 * const container = new Container();
 * container.registerBindings();
 * const logger = container.get('logger');
 * const mcpService = container.get('mcpGitHubFactory').create('github/myorg');
 */
class Container {
  constructor() {
    this.awilixContainer = awilix.createContainer({
      injectionMode: awilix.InjectionMode.PROXY
    });

    this.initialized = false;
  }

  /**
   * Register all service bindings with the container
   */
  registerBindings() {
    // ===== Core Services (Singleton) =====

    // Configuration - Load once and cache
    this.registerValue('config', this.loadConfig());

    // Logger - Singleton for application-wide logging
    this.registerFunction('logger', (cradle) => {
      return LoggerFactory.create({
        context: 'App',
        level: cradle.config.log?.level || 'info'
      });
    }).singleton();

    // Retry Helper - Shared retry logic
    this.registerClass('retryHelper', RetryHelper).singleton();

    // Error Handler - Centralized error handling
    this.registerFunction('errorHandler', (cradle) => {
      const logger = cradle.logger;
      const eventBus = null; // Will be registered later
      return new ErrorHandler(logger, eventBus);
    }).singleton();

    // ===== Existing Services (Registered as Singletons for Backward Compatibility) =====

    // Utils
    this.registerFunction('timeoutManager', () => {
      const TimeoutManager = require('../utils/timeoutManager');
      return new TimeoutManager();
    }).singleton();

    this.registerValue('timeUtils', require('../utils/timeUtils'));
    this.registerValue('memoryMonitor', require('../utils/memoryMonitor'));

    // Config
    this.registerValue('yamlConfig', require('../config/yamlConfig'));

    // Services - Existing services registered for backward compatibility
    // Note: Legacy services have been removed, replaced by new architecture

    this.registerFunction('flagsmithSyncService', () => {
      return require('../services/flagsmithSyncService');
    }).singleton();

    // ===== New Architecture Components =====

    // EventBus (shared events)
    this.registerFunction('eventBus', (cradle) => {
      const EventBus = require('../shared/events/EventBus');
      return new EventBus({
        logger: cradle.logger,
        enableLogging: process.env.EVENT_LOGGING === 'true'
      });
    }).singleton();

    // ===== Domain Layer =====

    // Domain Services
    this.registerFunction('riskCalculatorService', () => {
      const RiskCalculatorService = require('../core/services/RiskCalculatorService');
      return new RiskCalculatorService();
    }).singleton();

    this.registerFunction('prAnalyzerService', (cradle) => {
      const PRAnalyzerService = require('../core/services/PRAnalyzerService');
      return new PRAnalyzerService(cradle.riskCalculatorService, {
        logger: cradle.logger
      });
    }).singleton();

    // State Machine with in-memory repository for simplicity
    this.registerFunction('stateMachine', (cradle) => {
      const PRStateMachine = require('../core/services/PRStateMachine');
      const InMemoryStateRepository = require('../infrastructure/persistence/InMemoryStateRepository');

      // Use a placeholder in-memory repository
      // Note: This won't persist across restarts, but allows the app to run
      const repository = new InMemoryStateRepository('placeholder', 'placeholder', cradle.logger);
      repository.initialize();

      return new PRStateMachine(
        repository,
        { logger: cradle.logger, maxNotifications: 3 }
      );
    }).singleton();

    // ===== Infrastructure Layer Adapters =====

    // GitHub Adapter Factory (creates per-instance adapters)
    this.registerFunction('githubAdapter', (cradle) => {
      const MCPGitHubAdapter = require('../infrastructure/github/MCPGitHubAdapter');
      const config = cradle.config;

      return {
        create: (instanceKey) => {
          const instance = config.instances[instanceKey];
          if (!instance) {
            throw new Error(`Instance not found: ${instanceKey}`);
          }
          return new MCPGitHubAdapter(
            {
              key: instanceKey,
              owner: instance.owner,
              mcpName: instance.mcpName
            },
            cradle.logger,
            cradle.retryHelper
          );
        },
        createForOwner: (owner) => {
          const instanceKey = `github/${owner}`;
          const instance = config.instances[instanceKey];
          if (!instance) {
            throw new Error(`Instance not found for owner: ${owner}`);
          }
          return new MCPGitHubAdapter(
            {
              key: instanceKey,
              owner: instance.owner,
              mcpName: instance.mcpName
            },
            cradle.logger,
            cradle.retryHelper
          );
        }
      };
    }).singleton();

    // Telegram Adapter (implements ITelegramService)
    this.registerFunction('telegramAdapter', (cradle) => {
      const TelegramBotAdapter = require('../infrastructure/telegram/TelegramBotAdapter');
      const config = cradle.config;

      return new TelegramBotAdapter(
        config.app.telegram.botToken,
        {
          logger: cradle.logger,
          retryHelper: cradle.retryHelper,
          config: config,
          eventBus: cradle.eventBus
        }
      );
    }).singleton();

    // Agent Adapter (implements IAgentService)
    this.registerFunction('agentAdapter', (cradle) => {
      const OpenClawAgentAdapter = require('../infrastructure/agents/OpenClawAgentAdapter');

      return new OpenClawAgentAdapter(cradle.config, cradle.logger, cradle.retryHelper);
    }).singleton();

    // ===== Application Layer =====

    // Use Cases
    this.registerFunction('processPRUseCase', (cradle) => {
      const ProcessPRUseCase = require('../application/use-cases/ProcessPRUseCase');

      return new ProcessPRUseCase(
        cradle.stateMachine,
        cradle.prAnalyzerService,
        cradle.telegramAdapter,
        cradle.eventBus,
        { logger: cradle.logger }
      );
    }).singleton();

    this.registerFunction('sendNotificationUseCase', (cradle) => {
      const SendNotificationUseCase = require('../application/use-cases/SendNotificationUseCase');

      return new SendNotificationUseCase(
        cradle.telegramAdapter,
        cradle.stateMachine,
        cradle.eventBus,
        { logger: cradle.logger }
      );
    }).singleton();

    this.registerFunction('reviewPRUseCase', (cradle) => {
      const ReviewPRUseCase = require('../application/use-cases/ReviewPRUseCase');

      return new ReviewPRUseCase(
        cradle.agentAdapter,
        cradle.githubAdapter,
        cradle.stateMachine,
        cradle.eventBus,
        { logger: cradle.logger }
      );
    }).singleton();

    this.registerFunction('checkOutdatedReviewsUseCase', (cradle) => {
      const CheckOutdatedReviewsUseCase = require('../application/use-cases/CheckOutdatedReviewsUseCase');

      return new CheckOutdatedReviewsUseCase(
        cradle.githubAdapter,
        cradle.sendNotificationUseCase,
        cradle.stateMachine,
        cradle.eventBus,
        { logger: cradle.logger }
      );
    }).singleton();

    // Orchestrator
    this.registerFunction('prProcessingOrchestrator', (cradle) => {
      const PRProcessingOrchestrator = require('../application/orchestrators/PRProcessingOrchestrator');
      const config = cradle.config;

      // Build use cases object
      const useCases = {
        processPR: cradle.processPRUseCase,
        checkOutdatedReviews: cradle.checkOutdatedReviewsUseCase,
        githubService: cradle.githubAdapter
      };

      return new PRProcessingOrchestrator(
        useCases,
        config,
        cradle.eventBus,
        {
          logger: cradle.logger,
          pollInterval: config.app.checkIntervalMs
        }
      );
    }).singleton();

    // State Coordination Service
    this.registerFunction('stateCoordinationService', (cradle) => {
      const StateCoordinationService = require('../application/services/StateCoordinationService');
      const FileSystemStateRepository = require('../infrastructure/persistence/FileSystemStateRepository');

      return new StateCoordinationService(
        cradle.stateMachine,
        cradle.skipManager,
        new FileSystemStateRepository(cradle.logger),
        cradle.eventBus,
        { logger: cradle.logger }
      );
    }).singleton();

    // Unified State Service (consolidates all state management)
    this.registerFunction('unifiedStateService', (cradle) => {
      const UnifiedStateService = require('../application/services/UnifiedStateService');
      const FileSystemStateRepository = require('../infrastructure/persistence/FileSystemStateRepository');

      return new UnifiedStateService(
        cradle.stateMachine,
        new FileSystemStateRepository(cradle.logger),
        cradle.eventBus,
        cradle.logger
      );
    }).singleton();

    // Callback Handler (Telegram callbacks)
    this.registerFunction('callbackHandler', (cradle) => {
      const CallbackHandler = require('../infrastructure/telegram/CallbackHandler');

      return new CallbackHandler(
        cradle.reviewPRUseCase,
        cradle.stateMachine,
        cradle.eventBus,
        { logger: cradle.logger }
      );
    }).singleton();

    this.initialized = true;

    // Update error handler with event bus
    const errorHandler = this.awilixContainer.resolve('errorHandler');
    const eventBus = this.awilixContainer.resolve('eventBus');
    errorHandler.eventBus = eventBus;
  }

  /**
   * Load application configuration
   * @returns {Object} Configuration object
   */
  loadConfig() {
    try {
      return require('../config/yamlConfig');
    } catch (err) {
      throw new ConfigurationError(
        `Failed to load configuration: ${err.message}`,
        'config.yml',
        { originalError: err }
      );
    }
  }

  /**
   * Register a class as a dependency
   * @param {string} name - Dependency name
   * @param {Function} ClassConstructor - Class constructor
   * @returns {Object} Registration object for chaining
   */
  registerClass(name, ClassConstructor) {
    const registration = awilix.asClass(ClassConstructor);
    this.awilixContainer.register(name, registration);
    return registration;
  }

  /**
   * Register a function as a dependency
   * @param {string} name - Dependency name
   * @param {Function} factory - Factory function
   * @returns {Object} Registration object for chaining
   */
  registerFunction(name, factory) {
    const registration = awilix.asFunction(factory);
    this.awilixContainer.register(name, registration);
    return registration;
  }

  /**
   * Register a value as a dependency
   * @param {string} name - Dependency name
   * @param {*} value - Value to register
   * @returns {Object} Registration object for chaining
   */
  registerValue(name, value) {
    const registration = awilix.asValue(value);
    this.awilixContainer.register(name, registration);
    return registration;
  }

  /**
   * Resolve a dependency by name
   * @param {string} name - Dependency name
   * @returns {*} Resolved dependency
   */
  get(name) {
    if (!this.initialized) {
      this.registerBindings();
    }
    return this.awilixContainer.resolve(name);
  }

  /**
   * Check if a dependency is registered
   * @param {string} name - Dependency name
   * @returns {boolean} True if registered
   */
  has(name) {
    if (!this.initialized) {
      this.registerBindings();
    }
    return this.awilixContainer.hasRegistration(name);
  }

  /**
   * Register a new dependency
   * @param {string} name - Dependency name
   * @param {*} registration - Awilix registration
   */
  register(name, registration) {
    this.awilixContainer.register(name, registration);
  }

  /**
   * Create a scoped container for specific contexts (e.g., per-request)
   * @returns {Object} Scoped container
   */
  createScope() {
    return this.awilixContainer.createScope();
  }

  /**
   * Reset the container (useful for testing)
   */
  reset() {
    this.awilixContainer = awilix.createContainer({
      injectionMode: awilix.InjectionMode.PROXY
    });
    this.initialized = false;
  }

  /**
   * Get all registered dependency names
   * @returns {Array<string>} Array of registered names
   */
  getRegistrations() {
    return this.awilixContainer.registrations;
  }
}

// Create singleton instance
const container = new Container();

module.exports = container;
