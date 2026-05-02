const { DomainError, ConfigurationError, MCPError } = require('../../../../src/shared/errors');

describe('DomainError', () => {
  describe('constructor', () => {
    test('should create error with message', () => {
      const error = new DomainError('Test error');
      expect(error.message).toBe('Test error');
      expect(error.name).toBe('DomainError');
    });

    test('should create error with details', () => {
      const details = { key: 'value' };
      const error = new DomainError('Test error', details);
      expect(error.details).toEqual(details);
    });

    test('should have timestamp', () => {
      const error = new DomainError('Test error');
      expect(error.timestamp).toBeDefined();
      expect(new Date(error.timestamp)).toBeInstanceOf(Date);
    });

    test('should have stack trace', () => {
      const error = new DomainError('Test error');
      expect(error.stack).toBeDefined();
    });
  });

  describe('toJSON', () => {
    test('should convert to JSON', () => {
      const details = { key: 'value' };
      const error = new DomainError('Test error', details);
      const json = error.toJSON();

      expect(json).toEqual({
        name: 'DomainError',
        message: 'Test error',
        details: details,
        timestamp: error.timestamp
      });
    });

    test('should handle empty details', () => {
      const error = new DomainError('Test error');
      const json = error.toJSON();

      expect(json.details).toEqual({});
    });
  });
});

describe('ConfigurationError', () => {
  test('should extend DomainError', () => {
    const error = new ConfigurationError('Config error');
    expect(error instanceof DomainError).toBe(true);
    expect(error.name).toBe('ConfigurationError');
  });

  test('should store config path', () => {
    const error = new ConfigurationError('Config error', 'app.checkInterval');
    expect(error.configPath).toBe('app.checkInterval');
  });

  test('should include config path in toJSON', () => {
    const error = new ConfigurationError('Config error', 'app.checkInterval', { extra: 'data' });
    const json = error.toJSON();

    expect(json.configPath).toBe('app.checkInterval');
    expect(json.extra).toBe('data');
  });

  test('should handle null config path', () => {
    const error = new ConfigurationError('Config error');
    expect(error.configPath).toBeNull();
  });
});

describe('MCPError', () => {
  test('should extend DomainError', () => {
    const error = new MCPError('MCP error');
    expect(error instanceof DomainError).toBe(true);
    expect(error.name).toBe('MCPError');
  });

  test('should store MCP-specific properties', () => {
    const error = new MCPError('MCP error', 'github-work', 'list_pull_requests', true);
    expect(error.service).toBe('github-work');
    expect(error.operation).toBe('list_pull_requests');
    expect(error.retryable).toBe(true);
  });

  test('should include all properties in toJSON', () => {
    const error = new MCPError('MCP error', 'github-work', 'list_pull_requests', true, { extra: 'data' });
    const json = error.toJSON();

    expect(json.service).toBe('github-work');
    expect(json.operation).toBe('list_pull_requests');
    expect(json.retryable).toBe(true);
    expect(json.extra).toBe('data');
  });

  test('should have default retryable=true', () => {
    const error = new MCPError('MCP error');
    expect(error.retryable).toBe(true);
  });

  test('isRetryable should return retryable value', () => {
    const retryableError = new MCPError('MCP error', 'service', 'operation', true);
    expect(retryableError.isRetryable()).toBe(true);

    const nonRetryableError = new MCPError('MCP error', 'service', 'operation', false);
    expect(nonRetryableError.isRetryable()).toBe(false);
  });

  test('should handle null values for service and operation', () => {
    const error = new MCPError('MCP error');
    expect(error.service).toBeNull();
    expect(error.operation).toBeNull();
  });
});
