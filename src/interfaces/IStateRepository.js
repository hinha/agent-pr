/**
 * @interface IStateRepository
 *
 * Defines the contract for state persistence implementations.
 * This interface abstracts state storage operations, allowing different
 * implementations (file system, database, in-memory) to be used.
 *
 * @example
 * class MyStateRepository extends IStateRepository {
 *   async isProcessed(owner, repo, prId) {
 *     // implementation
 *   }
 *   // ... implement other methods
 * }
 */
class IStateRepository {
  /**
   * Check if a PR has been processed
   *
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} prId - Pull request ID
   * @returns {Promise<boolean>} True if PR is processed
   *
   * @example
   * const processed = await stateRepo.isProcessed('myorg', 'my-repo', 123);
   * if (processed) console.log('PR already processed');
   */
  async isProcessed(_owner, _repo, _prId) {
    throw new Error('Method isProcessed must be implemented');
  }

  /**
   * Mark a PR as processed
   *
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} prId - Pull request ID
   * @returns {Promise<void>}
   *
   * @example
   * await stateRepo.markProcessed('myorg', 'my-repo', 123);
   */
  async markProcessed(_owner, _repo, _prId) {
    throw new Error('Method markProcessed must be implemented');
  }

  /**
   * Get notification count for a PR
   *
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} prId - Pull request ID
   * @returns {Promise<number>} Notification count
   *
   * @example
   * const count = await stateRepo.getNotificationCount('myorg', 'my-repo', 123);
   * console.log(`Notified ${count} times`);
   */
  async getNotificationCount(_owner, _repo, _prId) {
    throw new Error('Method getNotificationCount must be implemented');
  }

  /**
   * Increment notification count for a PR
   *
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} prId - Pull request ID
   * @returns {Promise<number>} New notification count
   *
   * @example
   * const newCount = await stateRepo.incrementNotificationCount('myorg', 'my-repo', 123);
   * console.log(`Now notified ${newCount} times`);
   */
  async incrementNotificationCount(_owner, _repo, _prId) {
    throw new Error('Method incrementNotificationCount must be implemented');
  }

  /**
   * Get all processed PRs for a repository
   *
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Promise<Array<number>>} Array of processed PR IDs
   *
   * @example
   * const processed = await stateRepo.getProcessedPRs('myorg', 'my-repo');
   * console.log(`Processed ${processed.length} PRs`);
   */
  async getProcessedPRs(_owner, _repo) {
    throw new Error('Method getProcessedPRs must be implemented');
  }

  /**
   * Clear all processed PRs for a repository
   *
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Promise<void>}
   *
   * @example
   * await stateRepo.clearProcessedPRs('myorg', 'my-repo');
   */
  async clearProcessedPRs(_owner, _repo) {
    throw new Error('Method clearProcessedPRs must be implemented');
  }

  /**
   * Clear a specific PR from processed list
   *
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number} prId - PR ID to remove
   * @returns {Promise<void>}
   *
   * @example
   * await stateRepo.clearProcessed('myorg', 'my-repo', 123);
   */
  async clearProcessed(_owner, _repo, _prId) {
    throw new Error('Method clearProcessed must be implemented');
  }

  /**
   * Get repository statistics
   *
   * @returns {Promise<RepositoryStats>} Statistics object
   *
   * @example
   * const stats = await stateRepo.getStats();
   * console.log(`Total repos: ${stats.totalRepos}`);
   */
  async getStats() {
    throw new Error('Method getStats must be implemented');
  }

  /**
   * Initialize repository for a specific owner/repo
   *
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Promise<void>}
   */
  async initialize(_owner, _repo) {
    throw new Error('Method initialize must be implemented');
  }

  /**
   * Clean up resources
   *
   * @returns {Promise<void>}
   */
  async cleanup() {
    throw new Error('Method cleanup must be implemented');
  }
}

/**
 * @typedef {Object} RepositoryStats
 * @property {number} totalRepos - Total number of repositories
 * @property {number} totalProcessedPRs - Total processed PRs across all repos
 * @property {number} totalNotifications - Total notifications sent
 */

module.exports = IStateRepository;
