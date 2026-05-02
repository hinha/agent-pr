/**
 * RetryHelper - Centralized retry logic with exponential backoff
 *
 * This utility eliminates code duplication across services by providing
 * a consistent retry mechanism for all external operations.
 *
 * @example
 * const retryHelper = new RetryHelper(logger);
 * await retryHelper.retry(
 *   () => mcpService.callMCP('list_pull_requests', args),
 *   { retries: 3, minTimeout: 2000, context: 'MCP call' }
 * );
 */
class RetryHelper {
  /**
   * @param {Object} logger - Winston logger instance
   */
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Retry an operation with exponential backoff
   *
   * @param {Function} operation - The operation to retry (must return a Promise)
   * @param {Object} options - Retry configuration options
   * @param {number} options.retries - Number of retry attempts (default: 3)
   * @param {number} options.minTimeout - Initial timeout in ms (default: 1000)
   * @param {number} options.factor - Exponential backoff multiplier (default: 2)
   * @param {number} options.maxTimeout - Maximum timeout in ms (default: 30000)
   * @param {string} options.context - Context description for logging (default: 'Operation')
   * @param {Function} options.onRetry - Optional callback called before each retry
   * @returns {Promise<any>} Result of the successful operation
   * @throws {Error} The last error if all retries fail
   */
  async retry(operation, options = {}) {
    const {
      retries = 3,
      minTimeout = 1000,
      factor = 2,
      maxTimeout = 30000,
      context = 'Operation',
      onRetry = null
    } = options;

    let attempt = 0;
    let lastError;

    while (attempt < retries) {
      try {
        return await operation();
      } catch (err) {
        lastError = err;
        attempt++;

        if (attempt >= retries) {
          this.logger.error(`${context} failed after ${retries} attempts: ${err.message}`);
          throw err;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(minTimeout * Math.pow(factor, attempt - 1), maxTimeout);

        this.logger.warn(
          `${context} attempt ${attempt}/${retries} failed: ${err.message}, retrying in ${delay}ms`
        );

        // Call optional retry callback
        if (typeof onRetry === 'function') {
          try {
            await onRetry(attempt, delay, err);
          } catch (callbackErr) {
            this.logger.warn(`Retry callback failed: ${callbackErr.message}`);
          }
        }

        await this.sleep(delay);
      }
    }
  }

  /**
   * Sleep for a specified number of milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Create a retry wrapper for a specific operation with preset options
   * @param {Function} operation - The operation to wrap
   * @param {Object} options - Default retry options
   * @returns {Function} A wrapped function that will retry on failure
   */
  createRetryWrapper(operation, options = {}) {
    return (...args) => {
      return this.retry(() => operation(...args), options);
    };
  }

  /**
   * Retry with custom retry condition
   * @param {Function} operation - The operation to retry
   * @param {Function} shouldRetry - Function that receives the error and returns true if should retry
   * @param {Object} options - Retry configuration options
   * @returns {Promise<any>} Result of the successful operation
   */
  async retryIf(operation, shouldRetry, options = {}) {
    const { retries = 3, context = 'Operation' } = options;

    let attempt = 0;
    let lastError;

    while (attempt < retries) {
      try {
        return await operation();
      } catch (err) {
        lastError = err;
        attempt++;

        // Check if we should retry based on the error
        const canRetry = typeof shouldRetry === 'function' ? shouldRetry(err) : true;

        if (attempt >= retries || !canRetry) {
          this.logger.error(`${context} failed after ${attempt} attempt(s): ${err.message}`);
          throw err;
        }

        const delay = Math.min(options.minTimeout || 1000 * Math.pow(options.factor || 2, attempt - 1), options.maxTimeout || 30000);

        this.logger.warn(
          `${context} attempt ${attempt}/${retries} failed: ${err.message}, retrying in ${delay}ms`
        );

        await this.sleep(delay);
      }
    }
  }
}

module.exports = RetryHelper;
