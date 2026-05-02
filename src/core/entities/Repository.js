/**
 * Repository - Domain entity representing a GitHub repository
 *
 * This entity encapsulates repository configuration and metadata.
 *
 * @example
 * const repo = new Repository({
 *   owner: 'myorg',
 *   name: 'my-repo',
 *   threadId: 12345,
 *   instanceKey: 'github/myorg'
 * });
 */
class Repository {
  /**
   * @param {Object} data - Repository data
   * @param {string} data.owner - Repository owner
   * @param {string} data.name - Repository name
   * @param {number} data.threadId - Telegram thread ID for this repo
   * @param {string} data.instanceKey - Instance key (e.g., 'github/myorg')
   * @param {Object} [data.config] - Additional configuration
   */
  constructor(data) {
    this.owner = data.owner;
    this.name = data.name;
    this.threadId = data.threadId;
    this.instanceKey = data.instanceKey;
    this.config = data.config || {};
  }

  /**
   * Get unique identifier for this repository
   * @returns {string} Unique identifier
   */
  getIdentifier() {
    return `${this.owner}/${this.name}`;
  }

  /**
   * Get storage path for this repository
   * @returns {string} Storage path
   */
  getStoragePath() {
    return `${this.instanceKey.replace('github/', 'github-')}/${this.name}`;
  }

  /**
   * Check if this repository has a specific configuration
   * @param {string} key - Configuration key
   * @returns {boolean}
   */
  hasConfig(key) {
    return key in this.config;
  }

  /**
   * Get configuration value
   * @param {string} key - Configuration key
   @param {*} defaultValue - Default value if key doesn't exist
   * @returns {*} Configuration value
   */
  getConfig(key, defaultValue = null) {
    return this.config[key] !== undefined ? this.config[key] : defaultValue;
  }

  /**
   * Convert to plain object for serialization
   * @returns {Object} Plain object representation
   */
  toJSON() {
    return {
      owner: this.owner,
      name: this.name,
      threadId: this.threadId,
      instanceKey: this.instanceKey,
      config: this.config
    };
  }
}

module.exports = Repository;
