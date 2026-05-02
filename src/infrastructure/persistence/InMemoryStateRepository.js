const IStateRepository = require('../../interfaces/IStateRepository');

/**
 * InMemoryStateRepository - In-memory state persistence
 *
 * This repository implements the IStateRepository interface using in-memory storage.
 * Useful for testing or scenarios where persistence is not required.
 *
 * @example
 * const repo = new InMemoryStateRepository(owner, repo, logger);
 * await repo.initialize();
 * const processed = await repo.isProcessed(123);
 */
class InMemoryStateRepository extends IStateRepository {
  /**
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} logger - Winston logger instance
   */
  constructor(owner, repo, logger) {
    super();
    this.owner = owner;
    this.repo = repo;
    this.logger = logger;

    // In-memory storage
    this.storage = {
      processedPRs: new Set(),
      notificationCounts: new Map(),
      processedTimestamps: new Map()
    };

    this.loaded = false;
  }

  /**
   * Initialize repository (no-op for in-memory)
   * @returns {Promise<void>}
   */
  async initialize() {
    if (!this.loaded) {
      this.logger.debug(`[InMemoryStateRepository:${this.owner}/${this.repo}] Initialized`);
      this.loaded = true;
    }
  }

  /**
   * Check if a PR has been processed
   * @param {string} owner - Repository owner (unused)
   * @param {string} repo - Repository name (unused)
   * @param {number} prId - Pull request ID
   * @returns {Promise<boolean>} True if PR is processed
   */
  async isProcessed(owner, repo, prId) {
    await this.initialize();
    return this.storage.processedPRs.has(prId);
  }

  /**
   * Mark a PR as processed
   * @param {string} owner - Repository owner (unused)
   * @param {string} repo - Repository name (unused)
   * @param {number} prId - Pull request ID
   * @returns {Promise<void>}
   */
  async markProcessed(owner, repo, prId) {
    await this.initialize();

    this.storage.processedPRs.add(prId);
    this.storage.processedTimestamps.set(prId, Date.now());

    this.logger.debug(`[InMemoryStateRepository:${this.owner}/${this.repo}] Marked PR #${prId} as processed`);
  }

  /**
   * Get notification count for a PR
   * @param {string} owner - Repository owner (unused)
   * @param {string} repo - Repository name (unused)
   * @param {number} prId - Pull request ID
   * @returns {Promise<number>} Notification count
   */
  async getNotificationCount(owner, repo, prId) {
    await this.initialize();
    return this.storage.notificationCounts.get(prId) || 0;
  }

  /**
   * Increment notification count for a PR
   * @param {string} owner - Repository owner (unused)
   * @param {string} repo - Repository name (unused)
   * @param {number} prId - Pull request ID
   * @returns {Promise<number>} New notification count
   */
  async incrementNotificationCount(owner, repo, prId) {
    await this.initialize();

    const currentCount = this.storage.notificationCounts.get(prId) || 0;
    const newCount = currentCount + 1;
    this.storage.notificationCounts.set(prId, newCount);

    return newCount;
  }

  /**
   * Get all processed PRs for a repository
   * @param {string} owner - Repository owner (unused)
   * @param {string} repo - Repository name (unused)
   * @returns {Promise<Array<number>>} Array of processed PR IDs
   */
  async getProcessedPRs(owner, repo) {
    await this.initialize();
    return Array.from(this.storage.processedPRs);
  }

  /**
   * Clear all processed PRs for a repository
   * @param {string} owner - Repository owner (unused)
   * @param {string} repo - Repository name (unused)
   * @returns {Promise<void>}
   */
  async clearProcessedPRs(owner, repo) {
    await this.initialize();

    this.storage.processedPRs.clear();
    this.storage.notificationCounts.clear();
    this.storage.processedTimestamps.clear();

    this.logger.debug(`[InMemoryStateRepository:${this.owner}/${this.repo}] Cleared all state`);
  }

  /**
   * Clear a specific PR from processed list
   * @param {string} owner - Repository owner (unused)
   * @param {string} repo - Repository name (unused)
   * @param {number} prId - PR ID to remove
   * @returns {Promise<void>}
   */
  async clearProcessed(owner, repo, prId) {
    await this.initialize();

    this.storage.processedPRs.delete(prId);
    this.storage.processedTimestamps.delete(prId);

    this.logger.debug(`[InMemoryStateRepository:${this.owner}/${this.repo}] Cleared processed for PR #${prId}`);
  }

  /**
   * Get repository statistics
   * @returns {Promise<RepositoryStats>} Statistics object
   */
  async getStats() {
    await this.initialize();

    return {
      totalRepos: 1,
      totalProcessedPRs: this.storage.processedPRs.size,
      totalNotifications: Array.from(this.storage.notificationCounts.values()).reduce((sum, count) => sum + count, 0)
    };
  }

  /**
   * Clean up resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    this.storage.processedPRs.clear();
    this.storage.notificationCounts.clear();
    this.storage.processedTimestamps.clear();
    this.loaded = false;
    this.logger.debug(`[InMemoryStateRepository:${this.owner}/${this.repo}] Cleaned up`);
  }
}

module.exports = InMemoryStateRepository;
