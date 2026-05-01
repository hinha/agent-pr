/**
 * Unit tests for GitHubAdapterFactory
 */

const GitHubAdapterFactory = require('../../../../src/infrastructure/github/GitHubAdapterFactory');
const { ConfigurationError } = require('../../../../src/shared/errors');

// Mock MCPGitHubAdapter
jest.mock('../../../../src/infrastructure/github/MCPGitHubAdapter', () => {
  return class MockMCPGitHubAdapter {
    constructor(instance, logger, retryHelper) {
      this.instance = instance;
      this.logger = logger;
      this.retryHelper = retryHelper;
    }
    cleanup() {}
  };
});

describe('GitHubAdapterFactory', () => {
  let factory;
  let config;
  let loggerFactory;
  let retryHelper;

  beforeEach(() => {
    config = {
      instances: {
        'github/myorg': { mcp_name: 'github-work', owner: 'myorg' },
        'github/otherorg': { mcp_name: 'github-other', owner: 'otherorg' }
      }
    };
    loggerFactory = jest.fn((name) => ({ info: jest.fn(), error: jest.fn(), debug: jest.fn() }));
    retryHelper = { retry: jest.fn(), retryIf: jest.fn() };
    factory = new GitHubAdapterFactory(config, loggerFactory, retryHelper);
  });

  describe('create', () => {
    it('should create an adapter for a valid instance', () => {
      const adapter = factory.create('github/myorg');

      expect(adapter).toBeDefined();
      expect(adapter.instance).toEqual(config.instances['github/myorg']);
      expect(loggerFactory).toHaveBeenCalledWith('MCPGitHub:github/myorg');
    });

    it('should cache the adapter on second call', () => {
      const adapter1 = factory.create('github/myorg');
      const adapter2 = factory.create('github/myorg');

      expect(adapter1).toBe(adapter2);
      expect(loggerFactory).toHaveBeenCalledTimes(1);
    });

    it('should throw ConfigurationError for unknown instance', () => {
      expect(() => factory.create('github/unknown')).toThrow(ConfigurationError);
      expect(() => factory.create('github/unknown')).toThrow('Instance not found: github/unknown');
    });

    it('should create different adapters for different instances', () => {
      const adapter1 = factory.create('github/myorg');
      const adapter2 = factory.create('github/otherorg');

      expect(adapter1).not.toBe(adapter2);
    });
  });

  describe('createForOwner', () => {
    it('should create adapter using owner name', () => {
      const adapter = factory.createForOwner('myorg');

      expect(adapter).toBeDefined();
      expect(adapter.instance).toEqual(config.instances['github/myorg']);
    });

    it('should throw for unknown owner', () => {
      expect(() => factory.createForOwner('unknown')).toThrow(ConfigurationError);
    });
  });

  describe('has', () => {
    it('should return false before creating', () => {
      expect(factory.has('github/myorg')).toBe(false);
    });

    it('should return true after creating', () => {
      factory.create('github/myorg');
      expect(factory.has('github/myorg')).toBe(true);
    });
  });

  describe('getAdapterKeys', () => {
    it('should return empty array initially', () => {
      expect(factory.getAdapterKeys()).toEqual([]);
    });

    it('should return created adapter keys', () => {
      factory.create('github/myorg');
      factory.create('github/otherorg');

      const keys = factory.getAdapterKeys();
      expect(keys).toContain('github/myorg');
      expect(keys).toContain('github/otherorg');
      expect(keys).toHaveLength(2);
    });
  });

  describe('size', () => {
    it('should return 0 initially', () => {
      expect(factory.size()).toBe(0);
    });

    it('should return correct count after creating adapters', () => {
      factory.create('github/myorg');
      expect(factory.size()).toBe(1);

      factory.create('github/otherorg');
      expect(factory.size()).toBe(2);
    });
  });

  describe('clear', () => {
    it('should remove all cached adapters', () => {
      factory.create('github/myorg');
      factory.create('github/otherorg');
      factory.clear();

      expect(factory.size()).toBe(0);
      expect(factory.has('github/myorg')).toBe(false);
    });
  });
});
