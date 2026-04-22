const fs = require('fs/promises');
const path = require('path');
const config = require('../config/yamlConfig');
const logger = require('../utils/logger');

class SkipManager {
  constructor() {
    this.skipCache = new Map();
  }

  /**
   * Get unique key for a repository
   */
  getRepoKey(owner, repo) {
    return `${owner}/${repo}`;
  }

  /**
   * Get storage path for repository skip cache
   */
  getRepoSkipCachePath(owner, repo) {
    const dir = config.ensureRepoStorageDir(owner, repo);
    return path.join(dir, 'skip_cache.json');
  }

  /**
   * Load skip cache for a specific repository
   */
  async loadRepoSkipCache(owner, repo) {
    const key = this.getRepoKey(owner, repo);

    if (this.skipCache.has(key)) return;

    try {
      const skipCachePath = this.getRepoSkipCachePath(owner, repo);
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
      logger.debug(`[${key}] Loaded skip cache with ${validEntries.size} valid entries`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.error(`[${key}] Error loading skip cache: ${err.message}`);
      }
      this.skipCache.set(key, new Map());
    }
  }

  /**
   * Save skip cache for a specific repository
   */
  async saveRepoSkipCache(owner, repo) {
    const key = this.getRepoKey(owner, repo);
    const repoCache = this.skipCache.get(key);

    if (!repoCache) {
      logger.warn(`[${key}] No skip cache to save`);
      return;
    }

    try {
      const skipCachePath = this.getRepoSkipCachePath(owner, repo);
      const data = JSON.stringify(Object.fromEntries(repoCache), null, 2);
      await fs.writeFile(skipCachePath, data);
      logger.debug(`[${key}] Skip cache saved`);
    } catch (err) {
      logger.error(`[${key}] Failed to save skip cache: ${err.message}`);
      throw err;
    }
  }

  /**
   * Check if a PR is currently skipped
   */
  isSkipped(owner, repo, prId) {
    const key = this.getRepoKey(owner, repo);
    const repoCache = this.skipCache.get(key);

    if (!repoCache) return false;

    const expiry = repoCache.get(prId.toString());
    if (!expiry) return false;

    if (Date.now() > expiry) {
      repoCache.delete(prId.toString());
      this.saveRepoSkipCache(owner, repo).catch(err => {
        logger.error(`[${key}] Failed to save after cleanup: ${err.message}`);
      });
      return false;
    }

    return true;
  }

  /**
   * Add a skip entry for a PR
   */
  async addSkip(owner, repo, prId) {
    const key = this.getRepoKey(owner, repo);

    await this.loadRepoSkipCache(owner, repo);

    const instance = config.getInstanceByOwner(owner);
    const durationMs = instance.skipDurationMs;

    const repoCache = this.skipCache.get(key);
    if (!repoCache) {
      this.skipCache.set(key, new Map());
    }

    this.skipCache.get(key).set(prId.toString(), Date.now() + durationMs);
    await this.saveRepoSkipCache(owner, repo);

    logger.info(`[${key}] Added skip for PR #${prId} (duration: ${durationMs / 3600000}h)`);
  }

  /**
   * Remove a skip entry for a PR
   */
  async removeSkip(owner, repo, prId) {
    const key = this.getRepoKey(owner, repo);
    const repoCache = this.skipCache.get(key);

    if (!repoCache) return;

    if (repoCache.delete(prId.toString())) {
      await this.saveRepoSkipCache(owner, repo);
      logger.debug(`[${key}] Removed skip for PR #${prId}`);
    }
  }

  /**
   * Clear expired skip entries across all repositories
   */
  async cleanupExpiredEntries() {
    const now = Date.now();
    let totalCleaned = 0;

    for (const [key, repoCache] of this.skipCache.entries()) {
      let cleaned = 0;
      const expiredPrIds = [];

      for (const [prId, expiry] of repoCache.entries()) {
        if (now >= expiry) {
          expiredPrIds.push(prId);
        }
      }

      for (const prId of expiredPrIds) {
        repoCache.delete(prId);
        cleaned++;
      }

      if (cleaned > 0) {
        totalCleaned += cleaned;
        const [owner, repo] = key.split('/');
        this.saveRepoSkipCache(owner, repo).catch(err => {
          logger.error(`[${key}] Failed to save after cleanup: ${err.message}`);
        });
        logger.debug(`[${key}] Cleaned ${cleaned} expired skip entries`);
      }
    }

    if (totalCleaned > 0) {
      logger.info(`Cleaned up ${totalCleaned} expired skip entries across all repositories`);
    }

    return totalCleaned;
  }

  /**
   * Get skip statistics
   */
  getStats() {
    const stats = {
      totalRepos: this.skipCache.size,
      totalSkippedPRs: 0
    };

    for (const [key, repoCache] of this.skipCache.entries()) {
      stats.totalSkippedPRs += repoCache.size;
    }

    return stats;
  }
}

module.exports = new SkipManager();
