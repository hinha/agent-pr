const { DomainError, ConfigurationError, MCPError } = require('../../../../src/shared/errors');
const ErrorHandler = require('../../../../src/shared/errors/ErrorHandler');

// Mock logger
const createMockLogger = () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
});

// Mock event bus
const createMockEventBus = () => ({
  emitAsync: jest.fn().mockResolvedValue(undefined)
});

describe('ErrorHandler', () => {
  let errorHandler;
  let mockLogger;
  let mockEventBus;

  beforeEach(() => {
    mockLogger = createMockLogger();
    mockEventBus = createMockEventBus();
    errorHandler = new ErrorHandler(mockLogger, mockEventBus);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handle', () => {
    test('should handle MCPError correctly', async () => {
      const error = new MCPError('MCP operation failed', 'github-work', 'list_pull_requests', true);
      const result = await errorHandler.handle(error, 'TestContext');

      expect(result.success).toBe(false);
      expect(result.error).toBe('MCP operation failed');
      expect(result.retryable).toBe(true);
      expect(result.service).toBe('github-work');
      expect(result.operation).toBe('list_pull_requests');
      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith('error.occurred', {
        type: 'MCP_ERROR',
        error: expect.objectContaining({
          name: 'MCPError',
          service: 'github-work'
        }),
        context: 'TestContext',
        metadata: {}
      });
    });

    test('should handle ConfigurationError correctly', async () => {
      const error = new ConfigurationError('Invalid config', 'app.timeout');
      const result = await errorHandler.handle(error, 'TestContext');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid config');
      expect(result.retryable).toBe(false);
      expect(result.fatal).toBe(true);
      expect(result.configPath).toBe('app.timeout');
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith('error.occurred', {
        type: 'CONFIGURATION_ERROR',
        error: expect.objectContaining({
          name: 'ConfigurationError',
          configPath: 'app.timeout'
        }),
        context: 'TestContext',
        metadata: {}
      });
    });

    test('should handle DomainError correctly', async () => {
      const error = new DomainError('Business rule violated', { rule: 'max-prs' });
      const result = await errorHandler.handle(error, 'TestContext');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Business rule violated');
      expect(result.retryable).toBe(false);
      expect(result.details).toEqual({ rule: 'max-prs' });
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith('error.occurred', {
        type: 'DOMAIN_ERROR',
        error: expect.objectContaining({
          name: 'DomainError',
          details: { rule: 'max-prs' }
        }),
        context: 'TestContext',
        metadata: {}
      });
    });

    test('should handle unknown errors correctly', async () => {
      const error = new Error('Unknown error');
      const result = await errorHandler.handle(error, 'TestContext');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
      expect(result.retryable).toBe(true);
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith('error.occurred', {
        type: 'UNKNOWN_ERROR',
        error: expect.objectContaining({
          name: 'Error',
          message: 'Unknown error'
        }),
        context: 'TestContext',
        metadata: {}
      });
    });

    test('should include metadata in event bus publish', async () => {
      const error = new MCPError('MCP error', 'service', 'operation');
      const metadata = { userId: '123', requestId: '456' };

      await errorHandler.handle(error, 'TestContext', metadata);

      expect(mockEventBus.emitAsync).toHaveBeenCalledWith('error.occurred', {
        type: 'MCP_ERROR',
        error: expect.any(Object),
        context: 'TestContext',
        metadata: metadata
      });
    });
  });

  describe('handleMCPError', () => {
    test('should log and publish MCP error event', async () => {
      const error = new MCPError('MCP error', 'service', 'operation', false);
      const result = await errorHandler.handleMCPError(error, 'Context');

      expect(result).toEqual({
        success: false,
        error: 'MCP error',
        retryable: false,
        service: 'service',
        operation: 'operation'
      });
      expect(mockLogger.error).toHaveBeenCalled();
      expect(mockEventBus.emitAsync).toHaveBeenCalled();
    });
  });

  describe('handleConfigurationError', () => {
    test('should mark configuration errors as fatal', async () => {
      const error = new ConfigurationError('Config missing', 'app.key');
      const result = await errorHandler.handleConfigurationError(error, 'Context');

      expect(result.fatal).toBe(true);
      expect(result.retryable).toBe(false);
    });
  });

  describe('handleDomainError', () => {
    test('should use warn level for domain errors', async () => {
      const error = new DomainError('Domain rule violation');
      await errorHandler.handleDomainError(error, 'Context');

      expect(mockLogger.warn).toHaveBeenCalled();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });

  describe('handleUnknownError', () => {
    test('should log stack trace for unknown errors', async () => {
      const error = new Error('Unknown');
      await errorHandler.handleUnknownError(error, 'Context');

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          stack: expect.any(String)
        })
      );
    });
  });

  describe('publishErrorEvent', () => {
    test('should not throw when eventBus is null', async () => {
      const handlerWithoutEventBus = new ErrorHandler(mockLogger, null);
      const error = new Error('Test');

      await expect(
        handlerWithoutEventBus.publishErrorEvent({ type: 'TEST' })
      ).resolves.not.toThrow();
    });

    test('should handle eventBus.emitAsync failure gracefully', async () => {
      const failingEventBus = {
        emitAsync: jest.fn().mockRejectedValue(new Error('Publish failed'))
      };
      const handlerWithFailingEventBus = new ErrorHandler(mockLogger, failingEventBus);

      await expect(
        handlerWithFailingEventBus.publishErrorEvent({ type: 'TEST' })
      ).resolves.not.toThrow();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to publish error event')
      );
    });
  });

  describe('wrap', () => {
    test('should wrap async function with error handling', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const wrapped = errorHandler.wrap(fn, 'WrappedFunction');

      const result = await wrapped('arg1', 'arg2');

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
    });

    test('should handle errors in wrapped function', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Function failed'));
      const wrapped = errorHandler.wrap(fn, 'WrappedFunction');

      const result = await wrapped();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Function failed');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should rethrow fatal errors', async () => {
      const fatalFn = jest.fn().mockRejectedValue(
        new ConfigurationError('Fatal config error', 'app.key')
      );
      const wrapped = errorHandler.wrap(fatalFn, 'WrappedFunction');

      await expect(wrapped()).rejects.toThrow('Fatal config error');
    });
  });

  describe('middleware', () => {
    test('should create Express-style middleware', () => {
      const middleware = errorHandler.middleware();

      expect(typeof middleware).toBe('function');
      expect(middleware.length).toBe(4); // err, req, res, next
    });

    test('should handle errors in middleware', () => {
      const middleware = errorHandler.middleware();
      const err = new Error('Middleware error');
      const req = { method: 'GET', path: '/test', ip: '127.0.0.1' };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      middleware(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalled();
      expect(mockLogger.error).toHaveBeenCalled();
    });

    test('should handle fatal errors in middleware', () => {
      const middleware = errorHandler.middleware();
      const err = new ConfigurationError('Fatal error', 'app.key');
      const req = { method: 'POST', path: '/api/test', ip: '127.0.0.1' };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn()
      };
      const next = jest.fn();

      middleware(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Fatal error'
      });
    });
  });
});
