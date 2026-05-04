// We need to set up mocks before requiring the container
const awilix = require('awilix');

// Mock the config module
jest.mock('../../../src/config/yamlConfig', () => {
  const mockConfig = {
    instances: {
      'github/test-org': {
        key: 'github/test-org',
        owner: 'test-org',
        mcpName: 'github-work',
        repos: {
          'test-repo': { thread_id: 123 }
        }
      }
    },
    app: {
      checkIntervalMs: 420000,
      telegram: {
        bot_token: 'test-token',
        chatId: 456
      }
    },
    log: {
      level: 'info'
    }
  };
  return mockConfig;
});

// Mock all the services
jest.mock('../../../src/utils/timeoutManager', () => {
  return function() {
    return {
      setTimeout: jest.fn(),
      clearAll: jest.fn()
    };
  };
});

jest.mock('../../../src/utils/timeUtils', () => ({
  shouldSnooze: jest.fn(() => false),
  getSnoozeReason: jest.fn(() => 'Test reason')
}));

jest.mock('../../../src/utils/memoryMonitor', () => ({
  startMonitoring: jest.fn(),
  stopMonitoring: jest.fn()
}));

jest.mock('../../../src/services/flagsmithSyncService', () => ({
  init: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
  isActive: jest.fn(() => false),
  getValue: jest.fn()
}));

// Mock domain services
jest.mock('../../../src/core/services/RiskCalculatorService', () => {
  return class MockRiskCalculatorService {
    calculate() { return 'low'; }
  };
});

jest.mock('../../../src/core/services/PRAnalyzerService', () => {
  return class MockPRAnalyzerService {
    constructor(riskCalculator, options = {}) {
      this.riskCalculator = riskCalculator;
      this.logger = options.logger;
    }
    analyze() { return {}; }
  };
});

jest.mock('../../../src/core/services/PRStateMachine', () => {
  return class MockPRStateMachine {
    constructor(stateRepository, options = {}) {
      this.stateRepository = stateRepository;
      this.logger = options.logger;
    }
  };
});

jest.mock('../../../src/infrastructure/persistence/MultiRepoStateRepository', () => {
  return class MockMultiRepoStateRepository {
    constructor(logger) {
      this.logger = logger;
    }
  };
});

jest.mock('../../../src/shared/events/EventBus', () => {
  return class MockEventBus {
    constructor(options = {}) {
      this.logger = options.logger;
      this._handlers = new Map();
    }
    on(event, handler) {
      if (!this._handlers.has(event)) this._handlers.set(event, []);
      this._handlers.get(event).push(handler);
      return () => {
        const handlers = this._handlers.get(event);
        const idx = handlers.indexOf(handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    }
    emit(event, data) {
      const handlers = this._handlers.get(event) || [];
      handlers.forEach(h => h(data, event));
    }
    emitAsync(event, data) {
      return Promise.resolve();
    }
    once(event, handler) {
      this.on(event, handler);
    }
  };
});

jest.mock('../../../src/shared/errors/ErrorHandler', () => {
  return class MockErrorHandler {
    constructor(logger, eventBus) {
      this.logger = logger;
      this.eventBus = eventBus;
    }
    handle(err) { return err; }
  };
});

// Mock infrastructure adapters
jest.mock('../../../src/infrastructure/github/MCPGitHubAdapter', () => {
  return class MockMCPGitHubAdapter {
    constructor(instanceConfig, logger, retryHelper) {
      this.instanceConfig = instanceConfig;
      this.logger = logger;
      this.retryHelper = retryHelper;
    }
  };
});

jest.mock('../../../src/infrastructure/agents/OpenClawAgentAdapter', () => {
  return class MockOpenClawAgentAdapter {
    constructor(config, logger, retryHelper) {
      this.config = config;
      this.logger = logger;
      this.retryHelper = retryHelper;
    }
  };
});

jest.mock('../../../src/infrastructure/persistence/ReviewQueueRepository', () => {
  return class MockReviewQueueRepository {
    constructor(options = {}) {
      this.logger = options.logger;
    }
  };
});

jest.mock('../../../src/infrastructure/persistence/FileSystemStateRepository', () => {
  return class MockFileSystemStateRepository {
    constructor(owner, repoName, logger, baseDir) {
      this.owner = owner;
      this.repoName = repoName;
      this.logger = logger;
    }
  };
});

jest.mock('../../../src/infrastructure/persistence/SkipManager', () => {
  return class MockSkipManager {
    constructor(logger, config) {
      this.logger = logger;
      this.config = config;
    }
  };
});

jest.mock('../../../src/infrastructure/telegram/ConfirmationManager', () => {
  return class MockConfirmationManager {
    constructor(logger, timeoutManager, config) {
      this.logger = logger;
      this.timeoutManager = timeoutManager;
      this.config = config;
    }
  };
});

jest.mock('../../../src/infrastructure/telegram/CallbackHandler', () => {
  return class MockCallbackHandler {
    constructor(reviewPRUseCase, stateMachine, eventBus, options = {}) {
      this.reviewPRUseCase = reviewPRUseCase;
      this.stateMachine = stateMachine;
      this.eventBus = eventBus;
      this.options = options;
    }
  };
});

jest.mock('../../../src/infrastructure/telegram/CommandHandler', () => {
  return class MockCommandHandler {
    constructor(stateMachine, stateRepositoryFactory, options = {}) {
      this.stateMachine = stateMachine;
      this.stateRepositoryFactory = stateRepositoryFactory;
      this.options = options;
    }
  };
});

// Mock application use cases and services
jest.mock('../../../src/application/use-cases/ProcessPRUseCase', () => {
  return class MockProcessPRUseCase {
    constructor(stateMachine, analyzer, notificationService, eventBus, options = {}) {
      this.stateMachine = stateMachine;
    }
  };
});

jest.mock('../../../src/application/use-cases/SendNotificationUseCase', () => {
  return class MockSendNotificationUseCase {
    constructor(telegramService, stateMachine, eventBus, options = {}) {
      this.telegramService = telegramService;
    }
  };
});

jest.mock('../../../src/application/use-cases/ReviewPRUseCase', () => {
  return class MockReviewPRUseCase {
    constructor(agentService, stateMachine, eventBus, options = {}) {
      this.agentService = agentService;
    }
  };
});

jest.mock('../../../src/application/use-cases/ReviewQueueUseCase', () => {
  return class MockReviewQueueUseCase {
    constructor(queueRepository, eventBus, options = {}) {
      this.queueRepository = queueRepository;
    }
  };
});

jest.mock('../../../src/application/use-cases/CheckOutdatedReviewsUseCase', () => {
  return class MockCheckOutdatedReviewsUseCase {
    constructor(notificationService, stateMachine, eventBus, options = {}) {
      this.notificationService = notificationService;
    }
  };
});

jest.mock('../../../src/application/orchestrators/ReviewQueueWorker', () => {
  return class MockReviewQueueWorker {
    constructor(queueRepository, queueUseCase, reviewPRUseCase, eventBus, options = {}) {
      this.queueRepository = queueRepository;
      this.options = options;
    }
  };
});

jest.mock('../../../src/application/orchestrators/PRProcessingOrchestrator', () => {
  return class MockPRProcessingOrchestrator {
    constructor(useCases, config, eventBus, options = {}) {
      this.useCases = useCases;
      this.config = config;
    }
  };
});

jest.mock('../../../src/application/services/StateCoordinationService', () => {
  return class MockStateCoordinationService {
    constructor(stateMachine, stateRepository, eventBus, options = {}) {
      this.stateMachine = stateMachine;
    }
  };
});

jest.mock('../../../src/application/services/UnifiedStateService', () => {
  return class MockUnifiedStateService {
    constructor(stateMachine, stateRepository, eventBus, logger) {
      this.stateMachine = stateMachine;
    }
  };
});

const container = require('../../../src/container');
const BINDINGS = require('../../../src/container/bindings');
const { ConfigurationError } = require('../../../src/shared/errors');

describe('DI Container', () => {
  beforeEach(() => {
    // Reset container state for each test
    if (container.initialized) {
      container.reset();
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    test('should auto-initialize on first get', () => {
      expect(container.initialized).toBe(false);
      container.get('logger');
      expect(container.initialized).toBe(true);
    });

    test('should register bindings on initialization', () => {
      container.registerBindings();
      expect(container.initialized).toBe(true);
    });
  });

  describe('core services', () => {
    test('should resolve config', () => {
      const config = container.get('config');
      expect(config).toBeDefined();
      expect(config.instances).toBeDefined();
      expect(config.app).toBeDefined();
    });

    test('should resolve logger as singleton', () => {
      const logger1 = container.get('logger');
      const logger2 = container.get('logger');
      // Verify strict singleton identity
      expect(logger1).toBe(logger2);
    });

    test('should resolve retryHelper as singleton', () => {
      const helper1 = container.get('retryHelper');
      const helper2 = container.get('retryHelper');
      // Verify strict singleton identity
      expect(helper1).toBe(helper2);
    });

    test('should resolve eventBus as singleton', () => {
      const eventBus1 = container.get('eventBus');
      const eventBus2 = container.get('eventBus');
      expect(eventBus1).toBe(eventBus2);
    });

    test('should resolve errorHandler', () => {
      const handler = container.get('errorHandler');
      expect(handler).toBeDefined();
      expect(handler.handle).toBeDefined();
    });

    test('should resolve eventBus with correct methods', () => {
      const eventBus = container.get('eventBus');
      expect(eventBus).toBeDefined();
      expect(eventBus.on).toBeDefined();
      expect(eventBus.emit).toBeDefined();
      expect(eventBus.emitAsync).toBeDefined();
      expect(eventBus.once).toBeDefined();
    });
  });

  describe('domain services', () => {
    test('should resolve riskCalculatorService as singleton', () => {
      const service1 = container.get('riskCalculatorService');
      const service2 = container.get('riskCalculatorService');
      expect(service1).toBeDefined();
      expect(service1).toBe(service2);
    });

    test('should resolve prAnalyzerService as singleton', () => {
      const service1 = container.get('prAnalyzerService');
      const service2 = container.get('prAnalyzerService');
      expect(service1).toBeDefined();
      expect(service1).toBe(service2);
      expect(service1.riskCalculator).toBeDefined();
    });

    test('should resolve stateMachine as singleton', () => {
      const sm1 = container.get('stateMachine');
      const sm2 = container.get('stateMachine');
      expect(sm1).toBeDefined();
      expect(sm1).toBe(sm2);
    });
  });

  describe('existing services', () => {
    test('should resolve yamlConfig', () => {
      const yamlConfig = container.get('yamlConfig');
      expect(yamlConfig).toBeDefined();
    });

    test('should resolve timeoutManager as singleton', () => {
      const tm1 = container.get('timeoutManager');
      const tm2 = container.get('timeoutManager');
      // Both should have the required methods
      expect(tm1.setTimeout).toBeDefined();
      expect(tm1.clearAll).toBeDefined();
      expect(tm2.setTimeout).toBeDefined();
      expect(tm2.clearAll).toBeDefined();
    });

    test('should resolve timeUtils', () => {
      const timeUtils = container.get('timeUtils');
      expect(timeUtils).toBeDefined();
    });

    test('should resolve flagsmithSyncService', () => {
      const service = container.get('flagsmithSyncService');
      expect(service).toBeDefined();
    });
  });

  describe('container methods', () => {
    test('should check if dependency is registered', () => {
      expect(container.has('logger')).toBe(true);
      expect(container.has('nonExistent')).toBe(false);
    });

    test('should get all registrations', () => {
      container.registerBindings();
      const registrations = container.getRegistrations();
      // Awilix returns an object with registration names as keys
      expect(registrations).toBeDefined();
      expect(Object.keys(registrations).length).toBeGreaterThan(0);
    });

    test('should create scoped container', () => {
      const scope = container.createScope();
      expect(scope).toBeDefined();
      expect(scope.resolve).toBeDefined();
      expect(scope.register).toBeDefined();
    });

    test('should reset container', () => {
      container.registerBindings();
      expect(container.initialized).toBe(true);

      container.reset();
      expect(container.initialized).toBe(false);
    });

    test('should allow custom registration', () => {
      const testValue = { test: 'value' };
      container.register('customValue', awilix.asValue(testValue));

      const resolved = container.get('customValue');
      expect(resolved).toEqual(testValue);
    });
  });

  describe('eventBus functionality', () => {
    test('should allow subscribing to events', () => {
      const eventBus = container.get('eventBus');
      const handler = jest.fn();

      const unsubscribe = eventBus.on('TEST_EVENT', handler);

      expect(typeof unsubscribe).toBe('function');
    });

    test('should publish events to subscribers', () => {
      const eventBus = container.get('eventBus');
      const handler = jest.fn();

      eventBus.on('TEST_EVENT', handler);
      eventBus.emit('TEST_EVENT', { type: 'TEST_EVENT', data: 'test' });

      expect(handler).toHaveBeenCalledWith({ type: 'TEST_EVENT', data: 'test' }, 'TEST_EVENT');
    });

    test('should unsubscribe from events', () => {
      const eventBus = container.get('eventBus');
      const handler = jest.fn();

      const unsubscribe = eventBus.on('TEST_EVENT', handler);
      unsubscribe();

      eventBus.emit('TEST_EVENT', { type: 'TEST_EVENT', data: 'test' });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('BINDINGS constants', () => {
    test('should export binding constants', () => {
      expect(BINDINGS.CONFIG).toBe('config');
      expect(BINDINGS.LOGGER).toBe('logger');
      expect(BINDINGS.RETRY_HELPER).toBe('retryHelper');
      expect(BINDINGS.ERROR_HANDLER).toBe('errorHandler');
      expect(BINDINGS.EVENT_BUS).toBe('eventBus');
    });

    test('should include all core bindings', () => {
      expect(BINDINGS.CONFIG).toBeDefined();
      expect(BINDINGS.LOGGER).toBeDefined();
      expect(BINDINGS.RETRY_HELPER).toBeDefined();
      expect(BINDINGS.ERROR_HANDLER).toBeDefined();
      expect(BINDINGS.EVENT_BUS).toBeDefined();
    });

    test('should include new architecture bindings', () => {
      expect(BINDINGS.PROCESS_PR_USE_CASE).toBeDefined();
      expect(BINDINGS.SEND_NOTIFICATION_USE_CASE).toBeDefined();
      expect(BINDINGS.REVIEW_PR_USE_CASE).toBeDefined();
      expect(BINDINGS.CHECK_OUTDATED_REVIEWS_USE_CASE).toBeDefined();
      expect(BINDINGS.PR_PROCESSING_ORCHESTRATOR).toBeDefined();
      expect(BINDINGS.STATE_COORDINATION_SERVICE).toBeDefined();
      expect(BINDINGS.UNIFIED_STATE_SERVICE).toBeDefined();
      expect(BINDINGS.GITHUB_ADAPTER).toBeDefined();
      expect(BINDINGS.TELEGRAM_ADAPTER).toBeDefined();
      expect(BINDINGS.AGENT_ADAPTER).toBeDefined();
      expect(BINDINGS.FLAGSMITH_SYNC_SERVICE).toBeDefined();
    });
  });

  describe('githubAdapter factory', () => {
    test('should resolve githubAdapter with create and createForOwner methods', () => {
      const factory = container.get('githubAdapter');
      expect(factory).toBeDefined();
      expect(typeof factory.create).toBe('function');
      expect(typeof factory.createForOwner).toBe('function');
    });

    test('should create an adapter for a valid instance key', () => {
      const factory = container.get('githubAdapter');
      const adapter = factory.create('github/test-org');
      expect(adapter).toBeDefined();
      expect(adapter.instanceConfig).toBeDefined();
      expect(adapter.instanceConfig.key).toBe('github/test-org');
      expect(adapter.instanceConfig.owner).toBe('test-org');
      expect(adapter.instanceConfig.mcpName).toBe('github-work');
    });

    test('should throw when creating adapter for unknown instance key', () => {
      const factory = container.get('githubAdapter');
      expect(() => factory.create('github/unknown-org')).toThrow('Instance not found: github/unknown-org');
    });

    test('should create an adapter by owner using createForOwner', () => {
      const factory = container.get('githubAdapter');
      const adapter = factory.createForOwner('test-org');
      expect(adapter).toBeDefined();
      expect(adapter.instanceConfig).toBeDefined();
      expect(adapter.instanceConfig.key).toBe('github/test-org');
      expect(adapter.instanceConfig.owner).toBe('test-org');
      expect(adapter.instanceConfig.mcpName).toBe('github-work');
    });

    test('should throw when creating adapter for unknown owner via createForOwner', () => {
      const factory = container.get('githubAdapter');
      expect(() => factory.createForOwner('unknown-org')).toThrow('Instance not found for owner: unknown-org');
    });
  });

  describe('use cases and orchestrator', () => {
    test('should resolve processPRUseCase as singleton', () => {
      const useCase1 = container.get('processPRUseCase');
      const useCase2 = container.get('processPRUseCase');
      expect(useCase1).toBeDefined();
      expect(useCase1).toBe(useCase2);
    });

    test('should resolve sendNotificationUseCase as singleton', () => {
      const useCase1 = container.get('sendNotificationUseCase');
      const useCase2 = container.get('sendNotificationUseCase');
      expect(useCase1).toBeDefined();
      expect(useCase1).toBe(useCase2);
    });

    test('should resolve checkOutdatedReviewsUseCase as singleton', () => {
      const useCase1 = container.get('checkOutdatedReviewsUseCase');
      const useCase2 = container.get('checkOutdatedReviewsUseCase');
      expect(useCase1).toBeDefined();
      expect(useCase1).toBe(useCase2);
    });

    test('should resolve prProcessingOrchestrator as singleton', () => {
      const orch1 = container.get('prProcessingOrchestrator');
      const orch2 = container.get('prProcessingOrchestrator');
      expect(orch1).toBeDefined();
      expect(orch1).toBe(orch2);
      expect(orch1.useCases).toBeDefined();
      expect(orch1.useCases.processPR).toBeDefined();
      expect(orch1.useCases.checkOutdatedReviews).toBeDefined();
      expect(orch1.useCases.githubService).toBeDefined();
      expect(orch1.config).toBeDefined();
    });
  });

  describe('agentAdapter', () => {
    test('should resolve agentAdapter as singleton', () => {
      const adapter1 = container.get('agentAdapter');
      const adapter2 = container.get('agentAdapter');
      expect(adapter1).toBeDefined();
      expect(adapter1).toBe(adapter2);
    });

    test('should receive config, logger, and retryHelper', () => {
      const adapter = container.get('agentAdapter');
      expect(adapter.config).toBeDefined();
      expect(adapter.logger).toBeDefined();
      expect(adapter.retryHelper).toBeDefined();
    });
  });

  describe('reviewPRUseCase', () => {
    test('should resolve reviewPRUseCase as singleton', () => {
      const useCase1 = container.get('reviewPRUseCase');
      const useCase2 = container.get('reviewPRUseCase');
      expect(useCase1).toBeDefined();
      expect(useCase1).toBe(useCase2);
    });
  });

  describe('review queue system', () => {
    test('should resolve reviewQueueRepository as singleton', () => {
      const repo1 = container.get('reviewQueueRepository');
      const repo2 = container.get('reviewQueueRepository');
      expect(repo1).toBeDefined();
      expect(repo1).toBe(repo2);
    });

    test('should resolve reviewQueueUseCase as singleton', () => {
      const useCase1 = container.get('reviewQueueUseCase');
      const useCase2 = container.get('reviewQueueUseCase');
      expect(useCase1).toBeDefined();
      expect(useCase1).toBe(useCase2);
    });

    test('should resolve reviewQueueWorker as singleton', () => {
      const worker1 = container.get('reviewQueueWorker');
      const worker2 = container.get('reviewQueueWorker');
      expect(worker1).toBeDefined();
      expect(worker1).toBe(worker2);
    });

    test('should pass githubAdapterFactory to reviewQueueWorker', () => {
      const worker = container.get('reviewQueueWorker');
      expect(worker.options.githubAdapterFactory).toBeDefined();
      expect(typeof worker.options.githubAdapterFactory.create).toBe('function');
    });
  });

  describe('state services', () => {
    test('should resolve stateCoordinationService as singleton', () => {
      const service1 = container.get('stateCoordinationService');
      const service2 = container.get('stateCoordinationService');
      expect(service1).toBeDefined();
      expect(service1).toBe(service2);
    });

    test('should resolve unifiedStateService as singleton', () => {
      const service1 = container.get('unifiedStateService');
      const service2 = container.get('unifiedStateService');
      expect(service1).toBeDefined();
      expect(service1).toBe(service2);
    });

    test('should resolve stateRepositoryFactory with create method', () => {
      const factory = container.get('stateRepositoryFactory');
      expect(factory).toBeDefined();
      expect(typeof factory.create).toBe('function');
    });

    test('should create state repository via stateRepositoryFactory', () => {
      const factory = container.get('stateRepositoryFactory');
      const repo = factory.create('test-owner', 'test-repo');
      expect(repo).toBeDefined();
      expect(repo.owner).toBe('test-owner');
      expect(repo.repoName).toBe('test-repo');
    });
  });

  describe('telegram handlers', () => {
    test('should resolve callbackHandler as singleton', () => {
      const handler1 = container.get('callbackHandler');
      const handler2 = container.get('callbackHandler');
      expect(handler1).toBeDefined();
      expect(handler1).toBe(handler2);
    });

    test('should pass required dependencies to callbackHandler', () => {
      const handler = container.get('callbackHandler');
      expect(handler.reviewPRUseCase).toBeDefined();
      expect(handler.stateMachine).toBeDefined();
      expect(handler.eventBus).toBeDefined();
      expect(handler.options).toBeDefined();
      expect(handler.options.githubAdapter).toBeDefined();
      expect(handler.options.config).toBeDefined();
      expect(handler.options.skipManager).toBeDefined();
      expect(handler.options.stateRepositoryFactory).toBeDefined();
      expect(handler.options.checkOutdatedReviewsUseCase).toBeDefined();
      expect(handler.options.confirmationManager).toBeDefined();
      expect(handler.options.reviewQueueUseCase).toBeDefined();
      expect(handler.options.bot).toBeDefined();
      expect(handler.options.chatId).toBeDefined();
    });

    test('should resolve commandHandler as singleton', () => {
      const handler1 = container.get('commandHandler');
      const handler2 = container.get('commandHandler');
      expect(handler1).toBeDefined();
      expect(handler1).toBe(handler2);
    });

    test('should pass required dependencies to commandHandler', () => {
      const handler = container.get('commandHandler');
      expect(handler.stateMachine).toBeDefined();
      expect(handler.stateRepositoryFactory).toBeDefined();
      expect(handler.options).toBeDefined();
      expect(handler.options.logger).toBeDefined();
      expect(handler.options.config).toBeDefined();
      expect(handler.options.bot).toBeDefined();
      expect(handler.options.chatId).toBeDefined();
    });
  });

  describe('skipManager and confirmationManager', () => {
    test('should resolve skipManager as singleton', () => {
      const sm1 = container.get('skipManager');
      const sm2 = container.get('skipManager');
      expect(sm1).toBeDefined();
      expect(sm1).toBe(sm2);
    });

    test('should pass logger and config to skipManager', () => {
      const sm = container.get('skipManager');
      expect(sm.logger).toBeDefined();
      expect(sm.config).toBeDefined();
    });

    test('should resolve confirmationManager as singleton', () => {
      const cm1 = container.get('confirmationManager');
      const cm2 = container.get('confirmationManager');
      expect(cm1).toBeDefined();
      expect(cm1).toBe(cm2);
    });

    test('should pass logger, timeoutManager, and config to confirmationManager', () => {
      const cm = container.get('confirmationManager');
      expect(cm.logger).toBeDefined();
      expect(cm.timeoutManager).toBeDefined();
      expect(cm.config).toBeDefined();
    });
  });

  describe('registerClass', () => {
    test('should create a lifecycle builder with singleton, scoped, and transient methods', () => {
      const ContainerClass = container.constructor;
      const testContainer = new ContainerClass();
      testContainer.registerBindings();

      class TestService {
        constructor() {
          this.name = 'test';
        }
      }

      const builder = testContainer.registerClass('testServiceFromClass', TestService);
      expect(builder).toBeDefined();
      expect(typeof builder.singleton).toBe('function');
      expect(typeof builder.scoped).toBe('function');
      expect(typeof builder.transient).toBe('function');
    });

    test('should register a class as singleton and resolve it', () => {
      const ContainerClass = container.constructor;
      const testContainer = new ContainerClass();
      testContainer.registerBindings();

      class TestService {
        constructor() {
          this.name = 'test';
        }
      }

      testContainer.registerClass('testServiceSingleton', TestService).singleton();
      const instance = testContainer.get('testServiceSingleton');
      expect(instance).toBeDefined();
      expect(instance.name).toBe('test');
    });
  });

  // This test MUST be last because jest.resetModules() is destructive
  // and leaks to subsequent tests within the same file.
  describe('loadConfig error handling', () => {
    test('should throw ConfigurationError when config fails to load', () => {
      // Reset module registry so we can re-register a throwing mock
      jest.resetModules();

      // Register a mock that throws when the factory is invoked
      jest.doMock('../../../src/config/yamlConfig', () => {
        throw new Error('Simulated config load failure');
      });

      // Re-mock all other modules Container.js needs
      jest.doMock('../../../src/utils/timeoutManager', () => function() {
        return { setTimeout: jest.fn(), clearAll: jest.fn() };
      });
      jest.doMock('../../../src/utils/timeUtils', () => ({
        shouldSnooze: jest.fn(() => false),
        getSnoozeReason: jest.fn(() => 'Test reason')
      }));
      jest.doMock('../../../src/utils/memoryMonitor', () => ({
        startMonitoring: jest.fn(),
        stopMonitoring: jest.fn()
      }));
      jest.doMock('../../../src/services/flagsmithSyncService', () => ({
        init: jest.fn(),
        start: jest.fn(),
        stop: jest.fn(),
        isActive: jest.fn(() => false),
        getValue: jest.fn()
      }));

      const freshContainer = require('../../../src/container');
      const ContainerClass = freshContainer.constructor;
      const testContainer = new ContainerClass();
      let loadConfigError;
      try {
        testContainer.loadConfig();
      } catch (err) {
        loadConfigError = err;
      }

      expect(loadConfigError).toBeDefined();
      // Check by name since jest.resetModules creates a different class instance
      expect(loadConfigError.name).toBe('ConfigurationError');
      expect(loadConfigError.message).toContain('Failed to load configuration');
      expect(loadConfigError.message).toContain('Simulated config load failure');
      expect(loadConfigError.configPath).toBe('config.yml');
    });
  });
});
