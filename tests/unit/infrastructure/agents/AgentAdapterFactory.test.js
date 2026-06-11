/**
 * Unit Tests: AgentAdapterFactory
 *
 * Tests for the factory that selects the appropriate agent adapter
 * based on the provider_agent configuration.
 */

const AgentAdapterFactory = require('../../../../src/infrastructure/agents/AgentAdapterFactory');
const OpenClawAgentAdapter = require('../../../../src/infrastructure/agents/OpenClawAgentAdapter');
const HermesAgentAdapter = require('../../../../src/infrastructure/agents/HermesAgentAdapter');

describe('AgentAdapterFactory', () => {
  let mockConfig;
  let mockLogger;
  let mockRetryHelper;

  beforeEach(() => {
    mockConfig = {
      app: {
        providerAgent: 'openclaw'
      },
      reviewLevels: {},
      instances: {}
    };

    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockRetryHelper = {
      retry: jest.fn((fn) => fn())
    };
  });

  test('should return OpenClawAgentAdapter when provider_agent is openclaw', () => {
    mockConfig.app.providerAgent = 'openclaw';
    const adapter = AgentAdapterFactory.create(mockConfig, mockLogger, mockRetryHelper);
    expect(adapter).toBeInstanceOf(OpenClawAgentAdapter);
  });

  test('should return HermesAgentAdapter when provider_agent is hermes', () => {
    mockConfig.app.providerAgent = 'hermes';
    const adapter = AgentAdapterFactory.create(mockConfig, mockLogger, mockRetryHelper);
    expect(adapter).toBeInstanceOf(HermesAgentAdapter);
  });

  test('should return OpenClawAgentAdapter by default when no provider_agent configured', () => {
    delete mockConfig.app.providerAgent;
    const adapter = AgentAdapterFactory.create(mockConfig, mockLogger, mockRetryHelper);
    expect(adapter).toBeInstanceOf(OpenClawAgentAdapter);
  });

  test('should return OpenClawAgentAdapter for unknown provider value', () => {
    mockConfig.app.providerAgent = 'unknown';
    const adapter = AgentAdapterFactory.create(mockConfig, mockLogger, mockRetryHelper);
    expect(adapter).toBeInstanceOf(OpenClawAgentAdapter);
  });

  test('should return OpenClawAgentAdapter when app config is missing', () => {
    mockConfig = { instances: {} };
    const adapter = AgentAdapterFactory.create(mockConfig, mockLogger, mockRetryHelper);
    expect(adapter).toBeInstanceOf(OpenClawAgentAdapter);
  });

  test('should pass config, logger, and retryHelper to adapter', () => {
    mockConfig.app.providerAgent = 'hermes';
    const adapter = AgentAdapterFactory.create(mockConfig, mockLogger, mockRetryHelper);
    expect(adapter.config).toBe(mockConfig);
    expect(adapter.logger).toBe(mockLogger);
    expect(adapter.retryHelper).toBe(mockRetryHelper);
  });
});
