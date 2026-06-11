/**
 * AgentAdapterFactory - Creates the appropriate agent adapter based on configuration
 *
 * Supports:
 * - "hermes" → HermesAgentAdapter
 * - "openclaw" (default) → OpenClawAgentAdapter
 */
class AgentAdapterFactory {
  /**
   * Create an agent adapter based on the provider_agent config
   * @param {Object} config - Application configuration
   * @param {Object} logger - Winston logger instance
   * @param {Object} retryHelper - RetryHelper instance
   * @returns {IAgentService} Agent adapter instance
   */
  static create(config, logger, retryHelper) {
    const provider = config.app?.providerAgent || 'openclaw';

    switch (provider) {
      case 'hermes': {
        const HermesAgentAdapter = require('./HermesAgentAdapter');
        return new HermesAgentAdapter(config, logger, retryHelper);
      }
      case 'openclaw':
      default: {
        const OpenClawAgentAdapter = require('./OpenClawAgentAdapter');
        return new OpenClawAgentAdapter(config, logger, retryHelper);
      }
    }
  }
}

module.exports = AgentAdapterFactory;
