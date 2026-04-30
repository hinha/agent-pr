/**
 * MultiRepoStateRepository - State repository that manages multiple FileSystemStateRepository instances
 *
 * This repository implements the generic get/set/keys/delete interface required by PRStateMachine,
 * while internally using FileSystemStateRepository instances for each repository.
 *
 * Key format: {instanceKey}/{repoName}/pr/{prNumber}
 * Example: github/hinha/agent-pr/pr/123
 *
 * @example
 * const repo = new MultiRepoStateRepository(logger);
 * await repo.set('github/hinha/agent-pr/pr/123', { state: 'notified' });
 * const value = await repo.get('github/hinha/agent-pr/pr/123');
 */

const FileSystemStateRepository = require('./FileSystemStateRepository');

class MultiRepoStateRepository {
  /**
   * @param {Object} logger - Logger instance
   */
  constructor(logger) {
    this.logger = logger;
    // Cache of FileSystemStateRepository instances
    this.repositories = new Map();
  }

  /**
   * Parse state key to extract instanceKey, owner, repoName, prNumber
   * @param {string} key - State key in format {instanceKey}/{repoName}/pr/{prNumber}
   * @returns {Object|null} Parsed components or null if invalid
   * @private
   */
  _parseKey(key) {
    // Format: {instanceKey}/{repoName}/pr/{prNumber}
    // Example: github/hinha/agent-pr/pr/123
    const parts = key.split('/');

    // Check if we have the "pr" separator
    const prIndex = parts.indexOf('pr');
    if (prIndex === -1 || parts.length < prIndex + 2) {
      this.logger.warn(`[MultiRepoStateRepository] Invalid key format: ${key}`);
      return null;
    }

    // instanceKey is everything before "pr"
    // Example: "github/hinha/agent-pr" from "github/hinha/agent-pr/pr/123"
    const instanceKey = parts.slice(0, prIndex).join('/');

    // owner is the second-to-last part of instanceKey
    // Example: "hinha" from "github/hinha/agent-pr"
    const instanceParts = instanceKey.split('/');
    const owner = instanceParts[1] || instanceParts[0]; // github/owner or just owner

    // repoName is the last part of instanceKey
    const repoName = instanceParts[instanceParts.length - 1];

    // prNumber is after "pr"
    const prNumber = parts[prIndex + 1];

    return { instanceKey, owner, repoName, prNumber };
  }

  /**
   * Get or create FileSystemStateRepository for a specific repository
   * @param {string} owner - Repository owner (e.g., 'hinha')
   * @param {string} repoName - Repository name (e.g., 'gosm')
   * @returns {FileSystemStateRepository} Repository instance
   * @private
   */
  _getOrCreateRepository(owner, repoName) {
    const cacheKey = `${owner}/${repoName}`;

    let repository = this.repositories.get(cacheKey);
    if (!repository) {
      this.logger.info(`[MultiRepoStateRepository] Creating FileSystemStateRepository for owner=${owner}, repo=${repoName}`);
      repository = new FileSystemStateRepository(owner, repoName, this.logger);
      this.repositories.set(cacheKey, repository);
      this.logger.debug(`[MultiRepoStateRepository] Created repository for ${owner}/${repoName}, cacheKey=${cacheKey}`);
    }

    return repository;
  }

  /**
   * Get value by key
   * @param {string} key - State key in format {instanceKey}/{repoName}/pr/{prNumber}
   * @returns {Promise<*>} Stored value or undefined
   */
  async get(key) {
    const parsed = this._parseKey(key);
    if (!parsed) {
      return undefined;
    }

    const fsRepo = this._getOrCreateRepository(parsed.owner, parsed.repoName);

    try {
      // Use FileSystemStateRepository.getReviewState
      const state = await fsRepo.getReviewState(parsed.owner, parsed.repoName, parsed.prNumber);
      return state;
    } catch (err) {
      this.logger.debug(`[MultiRepoStateRepository] Error getting state for ${key}: ${err.message}`);
      return undefined;
    }
  }

  /**
   * Set value by key
   * @param {string} key - State key in format {instanceKey}/{repoName}/pr/{prNumber}
   * @param {*} value - Value to store
   * @returns {Promise<void>}
   */
  async set(key, value) {
    const parsed = this._parseKey(key);
    if (!parsed) {
      return;
    }

    const fsRepo = this._getOrCreateRepository(parsed.owner, parsed.repoName);

    try {
      // Use FileSystemStateRepository.saveReviewState
      await fsRepo.saveReviewState(parsed.owner, parsed.repoName, parsed.prNumber, value);
    } catch (err) {
      this.logger.error(`[MultiRepoStateRepository] Error setting state for ${key}: ${err.message}`);
    }
  }

  /**
   * Get all keys, optionally filtered by prefix
   * @param {string} prefix - Optional prefix to filter keys
   * @returns {Promise<Array<string>>} Array of keys
   */
  async keys(prefix) {
    // Collect keys from all repositories
    const allKeys = new Set(); // Use Set to avoid duplicates

    for (const [cacheKey, fsRepo] of this.repositories.entries()) {
      const [owner, repoName] = cacheKey.split('/');

      try {
        // Get all processed PRs
        const processedPRs = await fsRepo.getProcessedPRs(owner, repoName);

        // Also check review state cache directly for more complete list
        if (fsRepo.cache && fsRepo.cache.reviewState) {
          for (const prNumber of fsRepo.cache.reviewState.keys()) {
            if (!processedPRs.includes(parseInt(prNumber))) {
              processedPRs.push(parseInt(prNumber));
            }
          }
        }

        for (const prNumber of processedPRs) {
          // Build full key with standard format: github/owner/reponame/pr/number
          const fullKey = `github/${owner}/${repoName}/pr/${prNumber}`;
          if (!prefix || fullKey.startsWith(prefix)) {
            allKeys.add(fullKey);
          }
        }
      } catch (err) {
        this.logger.debug(`[MultiRepoStateRepository] Error getting keys from ${cacheKey}: ${err.message}`);
      }
    }

    return Array.from(allKeys);
  }

  /**
   * Delete a key
   * @param {string} key - State key in format {instanceKey}/{repoName}/pr/{prNumber}
   * @returns {Promise<void>}
   */
  async delete(key) {
    const parsed = this._parseKey(key);
    if (!parsed) {
      return;
    }

    const fsRepo = this._getOrCreateRepository(parsed.owner, parsed.repoName);

    try {
      // Use FileSystemStateRepository.clearReviewState
      await fsRepo.clearReviewState(parsed.owner, parsed.repoName, parsed.prNumber);
    } catch (err) {
      this.logger.error(`[MultiRepoStateRepository] Error deleting state for ${key}: ${err.message}`);
    }
  }

  /**
   * Clear all stored data and clean up repositories
   * @returns {Promise<void>}
   */
  async clear() {
    for (const fsRepo of this.repositories.values()) {
      try {
        await fsRepo.cleanup();
      } catch (err) {
        this.logger.debug(`[MultiRepoStateRepository] Error cleaning up repository: ${err.message}`);
      }
    }
    this.repositories.clear();
  }

  /**
   * Get the FileSystemStateRepository for a specific repository
   * This provides access to repository-specific methods like markOutdatedNotified
   *
   * @param {string} owner - Repository owner
   * @param {string} repoName - Repository name
   * @returns {FileSystemStateRepository} Repository instance
   */
  getRepository(owner, repoName) {
    return this._getOrCreateRepository(owner, repoName);
  }

  /**
   * Clean up resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    await this.clear();
  }
}

module.exports = MultiRepoStateRepository;
