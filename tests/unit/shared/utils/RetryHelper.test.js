const RetryHelper = require('../../../../src/shared/utils/RetryHelper');

// Mock logger
const createMockLogger = () => ({
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
  info: jest.fn()
});

describe('RetryHelper', () => {
  let retryHelper;
  let mockLogger;

  beforeEach(() => {
    mockLogger = createMockLogger();
    retryHelper = new RetryHelper(mockLogger);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('retry', () => {
    test('should return result on first successful attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      const result = await retryHelper.retry(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    test('should retry on failure and succeed', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');

      const result = await retryHelper.retry(operation, { retries: 3, minTimeout: 10 });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    });

    test('should throw error after all retries exhausted', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Always fails'));

      await expect(
        retryHelper.retry(operation, { retries: 3, minTimeout: 10 })
      ).rejects.toThrow('Always fails');

      expect(operation).toHaveBeenCalledTimes(3);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('failed after 3 attempts')
      );
    });

    test('should use exponential backoff', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');

      const startTime = Date.now();
      await retryHelper.retry(operation, { retries: 3, minTimeout: 50, factor: 2 });
      const elapsed = Date.now() - startTime;

      // First retry: 50ms, second retry: 100ms = at least 150ms
      expect(elapsed).toBeGreaterThanOrEqual(140);
    });

    test('should respect max timeout', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');

      const startTime = Date.now();
      await retryHelper.retry(operation, {
        retries: 3,
        minTimeout: 100,
        factor: 10,
        maxTimeout: 150
      });
      const elapsed = Date.now() - startTime;

      // First retry: 100ms, second retry: capped at 150ms = ~250ms
      expect(elapsed).toBeLessThan(300);
    });

    test('should use custom context in logs', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Fail'));

      await expect(
        retryHelper.retry(operation, {
          retries: 2,
          minTimeout: 10,
          context: 'CustomOperation'
        })
      ).rejects.toThrow();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('CustomOperation')
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('CustomOperation')
      );
    });

    test('should call onRetry callback before each retry', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');

      const onRetry = jest.fn().mockResolvedValue(undefined);

      await retryHelper.retry(operation, {
        retries: 3,
        minTimeout: 10,
        onRetry
      });

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenCalledWith(1, expect.any(Number), expect.any(Error));
      expect(onRetry).toHaveBeenCalledWith(2, expect.any(Number), expect.any(Error));
    });

    test('should handle onRetry callback failure', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockResolvedValue('success');

      const onRetry = jest.fn().mockRejectedValue(new Error('Callback failed'));

      // Should still succeed despite callback failure
      const result = await retryHelper.retry(operation, {
        retries: 2,
        minTimeout: 10,
        onRetry
      });

      expect(result).toBe('success');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Retry callback failed')
      );
    });
  });

  describe('sleep', () => {
    test('should sleep for specified milliseconds', async () => {
      const startTime = Date.now();
      await retryHelper.sleep(100);
      const elapsed = Date.now() - startTime;

      expect(elapsed).toBeGreaterThanOrEqual(95);
      expect(elapsed).toBeLessThan(150);
    });

    test('should return Promise', () => {
      const result = retryHelper.sleep(100);
      expect(result).toBeInstanceOf(Promise);
    });
  });

  describe('createRetryWrapper', () => {
    test('should create a wrapper with preset options', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockResolvedValue('success');

      const wrapped = retryHelper.createRetryWrapper(operation, {
        retries: 3,
        minTimeout: 10,
        context: 'WrappedOperation'
      });

      const result = await wrapped('arg1', 'arg2');

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledWith('arg1', 'arg2');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('WrappedOperation')
      );
    });

    test('should preserve operation context in wrapper', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Fail'));

      const wrapped = retryHelper.createRetryWrapper(operation, {
        retries: 2,
        minTimeout: 10,
        context: 'MyContext'
      });

      await expect(wrapped()).rejects.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('MyContext')
      );
    });
  });

  describe('retryIf', () => {
    test('should retry if shouldRetry returns true', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('Retryable error'))
        .mockResolvedValue('success');

      const shouldRetry = (err) => err.message.includes('Retryable');

      const result = await retryHelper.retryIf(operation, shouldRetry, {
        retries: 3,
        minTimeout: 10
      });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    test('should not retry if shouldRetry returns false', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('Non-retryable error'))
        .mockResolvedValue('success');

      const shouldRetry = (err) => err.message.includes('Retryable');

      await expect(
        retryHelper.retryIf(operation, shouldRetry, {
          retries: 3,
          minTimeout: 10
        })
      ).rejects.toThrow('Non-retryable error');

      expect(operation).toHaveBeenCalledTimes(1);
    });

    test('should default to retrying if shouldRetry not provided', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockResolvedValue('success');

      const result = await retryHelper.retryIf(operation, null, {
        retries: 2,
        minTimeout: 10
      });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    test('should exhaust retries if always retryable', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('Always retryable'));
      const shouldRetry = () => true;

      await expect(
        retryHelper.retryIf(operation, shouldRetry, {
          retries: 3,
          minTimeout: 10
        })
      ).rejects.toThrow('Always retryable');

      expect(operation).toHaveBeenCalledTimes(3);
    });
  });
});
