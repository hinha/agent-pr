const { DomainError, ConfigurationError, MCPError } = require('./index');

/**
 * ErrorHandler - Centralized error handling and classification
 *
 * This class provides a consistent way to handle errors across the application,
 * including logging, event publishing, and graceful degradation.
 */
class ErrorHandler {
  /**
   * @param {Object} logger - Winston logger instance
   * @param {Object} eventBus - Optional event bus for publishing error events
   */
  constructor(logger, eventBus = null) {
    this.logger = logger;
    this.eventBus = eventBus;
  }

  /**
   * Handle an error based on its type
   * @param {Error} error - The error to handle
   * @param {string} context - Context where the error occurred
   * @param {Object} metadata - Additional metadata about the error
   * @returns {Object} Error handling result
   */
  async handle(error, context = 'Unknown', metadata = {}) {
    if (error instanceof MCPError) {
      return await this.handleMCPError(error, context, metadata);
    } else if (error instanceof ConfigurationError) {
      return await this.handleConfigurationError(error, context, metadata);
    } else if (error instanceof DomainError) {
      return await this.handleDomainError(error, context, metadata);
    } else {
      return await this.handleUnknownError(error, context, metadata);
    }
  }

  /**
   * Handle MCP-specific errors
   * @param {MCPError} error - The MCP error
   * @param {string} context - Context where the error occurred
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Error handling result
   */
  async handleMCPError(error, context, metadata = {}) {
    this.logger.error(
      `[${context}] MCP Error: ${error.message}`,
      {
        service: error.service,
        operation: error.operation,
        retryable: error.retryable,
        details: error.details,
        ...metadata
      }
    );

    // Publish error event for monitoring
    await this.publishErrorEvent({
      type: 'MCP_ERROR',
      error: error.toJSON(),
      context,
      metadata
    });

    // Return graceful degradation response
    return {
      success: false,
      error: error.message,
      retryable: error.retryable,
      service: error.service,
      operation: error.operation
    };
  }

  /**
   * Handle configuration errors
   * @param {ConfigurationError} error - The configuration error
   * @param {string} context - Context where the error occurred
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Error handling result
   */
  async handleConfigurationError(error, context, metadata = {}) {
    this.logger.error(
      `[${context}] Configuration Error: ${error.message}`,
      {
        configPath: error.configPath,
        details: error.details,
        ...metadata
      }
    );

    await this.publishErrorEvent({
      type: 'CONFIGURATION_ERROR',
      error: error.toJSON(),
      context,
      metadata
    });

    // Configuration errors are usually fatal
    return {
      success: false,
      error: error.message,
      retryable: false,
      configPath: error.configPath,
      fatal: true
    };
  }

  /**
   * Handle domain errors
   * @param {DomainError} error - The domain error
   * @param {string} context - Context where the error occurred
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Error handling result
   */
  async handleDomainError(error, context, metadata = {}) {
    this.logger.warn(
      `[${context}] Domain Error: ${error.message}`,
      {
        details: error.details,
        ...metadata
      }
    );

    await this.publishErrorEvent({
      type: 'DOMAIN_ERROR',
      error: error.toJSON(),
      context,
      metadata
    });

    return {
      success: false,
      error: error.message,
      retryable: false,
      details: error.details
    };
  }

  /**
   * Handle unknown errors
   * @param {Error} error - The error
   * @param {string} context - Context where the error occurred
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Error handling result
   */
  async handleUnknownError(error, context, metadata = {}) {
    this.logger.error(
      `[${context}] Unexpected Error: ${error.message}`,
      {
        stack: error.stack,
        name: error.name,
        ...metadata
      }
    );

    await this.publishErrorEvent({
      type: 'UNKNOWN_ERROR',
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack
      },
      context,
      metadata
    });

    return {
      success: false,
      error: error.message,
      retryable: true // Default to retryable for unknown errors
    };
  }

  /**
   * Publish error event to event bus if available
   * @param {Object} event - Error event data
   */
  async publishErrorEvent(event) {
    if (this.eventBus && typeof this.eventBus.emitAsync === 'function') {
      try {
        await this.eventBus.emitAsync('error.occurred', event);
      } catch (publishErr) {
        this.logger.warn(`Failed to publish error event: ${publishErr.message}`);
      }
    }
  }

  /**
   * Create a wrapped version of an async function that handles errors
   * @param {Function} fn - The async function to wrap
   * @param {string} context - Context description
   * @returns {Function} Wrapped function with error handling
   */
  wrap(fn, context = 'WrappedFunction') {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        const result = this.handle(error, context, { args });
        if (result.fatal) {
          throw error;
        }
        return result;
      }
    };
  }

  /**
   * Create a middleware-style error handler for Express-like frameworks
   * @returns {Function} Middleware function
   */
  middleware() {
    return (err, req, res, next) => {
      const result = this.handle(err, 'HTTP_REQUEST', {
        method: req.method,
        path: req.path,
        ip: req.ip
      });

      if (result.fatal) {
        return res.status(500).json({
          error: 'Internal Server Error',
          message: result.error
        });
      }

      res.status(500).json(result);
    };
  }
}

module.exports = ErrorHandler;
