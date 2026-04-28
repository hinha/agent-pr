/**
 * Export all error classes for easy importing
 */

const DomainError = require('./DomainError');
const ConfigurationError = require('./ConfigurationError');
const MCPError = require('./MCPError');

module.exports = {
  DomainError,
  ConfigurationError,
  MCPError
};
