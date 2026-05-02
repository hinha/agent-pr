const DomainError = require('./DomainError');

/**
 * Thrown when configuration is invalid or missing
 */
class ConfigurationError extends DomainError {
  /**
   * @param {string} message - Error message
   * @param {string} configPath - Path to the configuration value that caused the error
   * @param {Object} details - Additional error details
   */
  constructor(message, configPath = null, details = {}) {
    super(message, { configPath, ...details });
    this.name = 'ConfigurationError';
    this.configPath = configPath;
  }

  toJSON() {
    const base = super.toJSON();
    return {
      ...base,
      configPath: this.configPath,
      ...(base.details || {})
    };
  }
}

module.exports = ConfigurationError;
