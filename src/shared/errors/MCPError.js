const DomainError = require('./DomainError');

/**
 * Thrown when MCP (Model Context Protocol) operations fail
 */
class MCPError extends DomainError {
  /**
   * @param {string} message - Error message
   * @param {string} service - The MCP service that failed (e.g., 'github-work')
   * @param {string} operation - The MCP operation that failed (e.g., 'list_pull_requests')
   * @param {boolean} retryable - Whether this error is retryable
   * @param {Object} details - Additional error details
   */
  constructor(message, service = null, operation = null, retryable = true, details = {}) {
    super(message, { service, operation, retryable, ...details });
    this.name = 'MCPError';
    this.service = service;
    this.operation = operation;
    this.retryable = retryable;
  }

  /**
   * Check if this error is retryable
   * @returns {boolean}
   */
  isRetryable() {
    return this.retryable;
  }

  toJSON() {
    const base = super.toJSON();
    return {
      ...base,
      service: this.service,
      operation: this.operation,
      retryable: this.retryable,
      ...(base.details || {})
    };
  }
}

module.exports = MCPError;
