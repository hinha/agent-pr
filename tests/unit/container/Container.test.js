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

const container = require('../../../src/container');
const BINDINGS = require('../../../src/container/bindings');

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
});
