const fs = require('fs/promises');
const path = require('path');

/**
 * SkipManager - Manages PR skip functionality
 *
 * This service tracks PRs that should be temporarily skipped from notifications
 * (e.g., user clicked "Skip (3h)" button). Skip entries expire after a configured duration.
 *
 * Follows the same repository-scoped pattern as FileSystemStateRepository.
 *
 * @example
 * const skipManager = new SkipManager(logger, config);
 * await skipManager.addSkip('owner', 'repo', 123);
 * const isSkipped = skipManager.isSkipped('owner', 'repo', 123);
 */
class SkipManager {
  /**
   * @param {Object} logger - Winston logger instance
   * @param {Object} config - Application config
   */
  constructor(logger, config) {
    this.logger = logger;
    this.config = config;
    this.skipCache = new Map();
    this.loaded = false;
  }

  /**
   * Get unique key for a repository
   * @private
   */
  getRepoKey(owner, repo) {
    return `${owner}/${repo}`;
  }

  /**
   * Get storage path for a repository (matches FileSystemStateRepository pattern)
   * @private
   */
  getStoragePath(owner, repo) {
    // Match FileSystemStateRepository path structure
    const instanceKey = `github-${owner}`;
    return path.join(process.cwd(), 'data/instances', instanceKey, repo);
  }

  /**
   * Get skip cache file path for a repository
   * @private
   */
  getSkipCachePath(owner, repo) {
    return path.join(this.getStoragePath(owner, repo), 'skip_cache.json');
  }

  /**
   * Get skip duration from config (in milliseconds)
   * @private
   */
  getSkipDuration(instance) {
    // Default 3 hours, can be overridden in config
    return instance?.skipDurationMs || 3 * 60 * 60 * 1000;
  }

  /**
   * Load skip cache for a specific repository
   * @private
   */
  async loadRepoSkipCache(owner, repo) {
    const key = this.getRepoKey(owner, repo);

    if (this.skipCache.has(key)) {
      return;
    }

    try {
      const skipCachePath = this.getSkipCachePath(owner, repo);
      const raw = await fs.readFile(skipCachePath, 'utf8');
      const parsed = JSON.parse(raw);

      const now = Date.now();
      const validEntries = new Map();

      for (const [prId, expiry] of Object.entries(parsed)) {
        if (now < expiry) {
          validEntries.set(prId, expiry);
        }
      }

      this.skipCache.set(key, validEntries);
      this.logger.debug(`[SkipManager:${key}] Loaded skip cache with ${validEntries.size} valid entries`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.logger.error(`[SkipManager:${key}] Error loading skip cache: ${err.message}`);
      }
      this.skipCache.set(key, new Map());
    }
  }

  /**
   * Save skip cache for a specific repository
   * @private
   */
  async saveRepoSkipCache(owner, repo) {
    const key = this.getRepoKey(owner, repo);
    const repoCache = this.skipCache.get(key);

    if (!repoCache) {
      this.logger.warn(`[SkipManager:${key}] No skip cache to save`);
      return;
    }

    try {
      // Ensure directory exists
      const storagePath = this.getStoragePath(owner, repo);
      await fs.mkdir(storagePath, { recursive: true });

      const skipCachePath = this.getSkipCachePath(owner, repo);
      const data = JSON.stringify(Object.fromEntries(repoCache), null, 2);
      await fs.writeFile(skipCachePath, data, 'utf8');
      this.logger.debug(`[SkipManager:${key}] Skip cache saved`);
    } catch (err) {
      this.logger.error(`[SkipManager:${key}] Failed to save skip cache: ${err.message}`);
      throw err;
    }
  }

  /**
   * Check if a PR is currently skipped
   *
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number|string} prId - Pull request ID
   * @returns {Promise<boolean>} True if PR is currently skipped
   */
  async isSkipped(owner, repo, prId) {
    await this.loadRepoSkipCache(owner, repo);

    const key = this.getRepoKey(owner, repo);
    const repoCache = this.skipCache.get(key);

    if (!repoCache) return false;

    const expiry = repoCache.get(prId.toString());
    if (!expiry) return false;

    if (Date.now() > expiry) {
      // Expired, remove it
      repoCache.delete(prId.toString());
      await this.saveRepoSkipCache(owner, repo);
      return false;
    }

    return true;
  }

  /**
   * Add a skip entry for a PR
   *
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number|string} prId - Pull request ID
   * @returns {Promise<void>}
   */
  async addSkip(owner, repo, prId) {
    const key = this.getRepoKey(owner, repo);

    await this.loadRepoSkipCache(owner, repo);

    // Find instance config for this owner/repo
    const instanceKey = `github/${owner}`;
    const instance = this.config.instances?.[instanceKey];
    const durationMs = this.getSkipDuration(instance);

    const repoCache = this.skipCache.get(key);
    if (!repoCache) {
      this.skipCache.set(key, new Map());
    }

    this.skipCache.get(key).set(prId.toString(), Date.now() + durationMs);
    await this.saveRepoSkipCache(owner, repo);

    this.logger.info(`[SkipManager:${key}] Added skip for PR #${prId} (duration: ${durationMs / 3600000}h)`);
  }

  /**
   * Remove a skip entry for a PR
   *
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {number|string} prId - Pull request ID
   * @returns {Promise<void>}
   */
  async removeSkip(owner, repo, prId) {
    const key = this.getRepoKey(owner, repo);

    await this.loadRepoSkipCache(owner, repo);

    const repoCache = this.skipCache.get(key);

    if (!repoCache) return;

    if (repoCache.delete(prId.toString())) {
      await this.saveRepoSkipCache(owner, repo);
      this.logger.debug(`[SkipManager:${key}] Removed skip for PR #${prId}`);
    }
  }

  /**
   * Clear expired skip entries for a specific repository
   *
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Promise<number>} Number of entries cleaned
   */
  async removeExpired(owner, repo) {
    const key = this.getRepoKey(owner, repo);

    await this.loadRepoSkipCache(owner, repo);

    const repoCache = this.skipCache.get(key);
    if (!repoCache) return 0;

    const now = Date.now();
    let cleaned = 0;

    for (const [prId, expiry] of repoCache.entries()) {
      if (now >= expiry) {
        repoCache.delete(prId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      await this.saveRepoSkipCache(owner, repo);
      this.logger.debug(`[SkipManager:${key}] Cleaned ${cleaned} expired skip entries`);
    }

    return cleaned;
  }

  /**
   * Get skip statistics
   *
   * @returns {Object} Statistics object
   */
  getStats() {
    const stats = {
      totalRepos: this.skipCache.size,
      totalSkippedPRs: 0
    };

    for (const [, repoCache] of this.skipCache.entries()) {
      stats.totalSkippedPRs += repoCache.size;
    }

    return stats;
  }

  /**
   * Clean up resources
   *
   * @returns {Promise<void>}
   */
  async cleanup() {
    this.logger.debug('[SkipManager] Cleaning up...');
    this.skipCache.clear();
    this.loaded = false;
  }
}

module.exports = SkipManager;
