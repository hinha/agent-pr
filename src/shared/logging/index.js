/**
 * Export LoggerFactory and provide convenience exports
 */

const LoggerFactory = require('./LoggerFactory');

// Export the factory
module.exports = LoggerFactory;

// Also export as a named export for flexibility
module.exports.LoggerFactory = LoggerFactory;
