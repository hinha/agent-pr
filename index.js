#!/usr/bin/env node
/**
 * PR Monitor Daemon - Main Entry Point
 *
 * This is the main entry point for the GitHub PR monitoring daemon.
 * It uses a Bootstrap class to initialize the application with proper
 * dependency injection and graceful shutdown.
 *
 * Architecture:
 * - Bootstrap handles initialization
 * - DI Container manages all dependencies
 * - Orchestrators coordinate workflows
 * - Use cases encapsulate business logic
 * - Adapters abstract external services
 */

const Bootstrap = require('./src/bootstrap/Bootstrap');

// Create bootstrap instance
const bootstrap = new Bootstrap();

// Start the application
bootstrap.start().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});

// Export for testing
module.exports = bootstrap;
