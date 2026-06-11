const MCPGitHubAdapter = require('./MCPGitHubAdapter');

/**
 * GitHubAdapterFactory - Factory for creating GitHub service instances
 *
 * This factory manages the creation and caching of MCPGitHubAdapter instances
 * for different GitHub organizations/instances.
 *
 * @example
 * const factory = new GitHubAdapterFactory(config, loggerFactory, retryHelper);
 * const adapter = factory.create('github/myorg');
 */
class GitHubAdapterFactory {
  /**
   * @param {Object} config - Application configuration
   * @param {Function} loggerFactory - Logger factory function
   * @param {Object} retryHelper - RetryHelper instance
   */
  constructor(config, loggerFactory, retryHelper) {
    this.config = config;
    this.loggerFactory = loggerFactory;
    this.retryHelper = retryHelper;
    this.adapters = new Map();
  }

  /**
   * Create or get cached MCP GitHub adapter for an instance
   * @param {string} instanceKey - Instance key (e.g., 'github/myorg')
   * @returns {MCPGitHubAdapter} GitHub adapter instance
   * @throws {Error} If instance not found
   */
  create(instanceKey) {
    if (!this.adapters.has(instanceKey)) {
      const instance = this.config.instances[instanceKey];
      if (!instance) {
        const { ConfigurationError } = require('../../shared/errors');
        throw new ConfigurationError(
          `Instance not found: ${instanceKey}`,
          `instances.${instanceKey}`
        );
      }

      const logger = this.loggerFactory(`MCPGitHub:${instanceKey}`);
      const adapter = new MCPGitHubAdapter(
        {
          ...instance,
          providerAgent: this.config.app.providerAgent,
          githubRuntime: this.config.app.githubRuntime,
          agent: instance.agent
        },
        logger,
        this.retryHelper
      );
      this.adapters.set(instanceKey, adapter);
    }

    return this.adapters.get(instanceKey);
  }

  /**
   * Create or get cached MCP GitHub adapter for an owner
   * @param {string} owner - Repository owner
   * @returns {MCPGitHubAdapter} GitHub adapter instance
   * @throws {Error} If instance not found
   */
  createForOwner(owner) {
    const instanceKey = `github/${owner}`;
    return this.create(instanceKey);
  }

  /**
   * Get all cached adapter keys
   * @returns {Array<string>} Array of instance keys
   */
  getAdapterKeys() {
    return Array.from(this.adapters.keys());
  }

  /**
   * Check if an adapter exists for an instance
   * @param {string} instanceKey - Instance key
   * @returns {boolean} True if adapter exists
   */
  has(instanceKey) {
    return this.adapters.has(instanceKey);
  }

  /**
   * Clear all cached adapters
   * @returns {void}
   */
  clear() {
    // Clean up all adapters
    for (const [instanceKey, adapter] of this.adapters.entries()) {
      try {
        adapter.cleanup();
      } catch (err) {
        console.error(`Failed to cleanup adapter for ${instanceKey}: ${err.message}`);
      }
    }
    this.adapters.clear();
  }

  /**
   * Get adapter count
   * @returns {number} Number of cached adapters
   */
  size() {
    return this.adapters.size;
  }
}

module.exports = GitHubAdapterFactory;
