const fs = require('fs/promises');
const path = require('path');
const config = require('../config/yamlConfig');
const logger = require('../utils/logger');

class RepositoryStateManager {
  constructor() {
    this.state = new Map();
    this.loaded = false;
  }

  /**
   * Get unique key for a repository
   */
  getRepoKey(owner, repo) {
    return `${owner}/${repo}`;
  }

  /**
   * Get or create state for a repository (async, waits for load)
   */
  async getRepoState(owner, repo) {
    const key = this.getRepoKey(owner, repo);

    if (!this.state.has(key)) {
      this.state.set(key, {
        processedPRs: new Set(),
        notificationCount: new Map(),
        processedTimestamps: new Map(),
        loaded: false,
        loadPromise: null
      });
    }

    const repoState = this.state.get(key);

    // Wait for state to load if not already loaded
    if (!repoState.loaded) {
      if (!repoState.loadPromise) {
        repoState.loadPromise = this.loadRepoState(owner, repo).catch(err => {
          logger.error(`Failed to load state for ${key}: ${err.message}`);
          throw err;
        }).finally(() => {
          repoState.loadPromise = null;
        });
      }
      await repoState.loadPromise;
    }

    return repoState;
  }

  /**
   * Get or create state for a repository (sync, doesn't wait for load)
   * Use this only when you need immediate access and will handle loading separately
   */
  getRepoStateSync(owner, repo) {
    const key = this.getRepoKey(owner, repo);

    if (!this.state.has(key)) {
      this.state.set(key, {
        processedPRs: new Set(),
        notificationCount: new Map(),
        processedTimestamps: new Map(),
        loaded: false,
        loadPromise: null
      });

      // Start loading in background
      this.loadRepoState(owner, repo).catch(err => {
        logger.error(`Failed to load state for ${key}: ${err.message}`);
      });
    }

    return this.state.get(key);
  }

  /**
   * Get storage directory for a repository
   */
  getRepoStorageDir(owner, repo) {
    return config.ensureRepoStorageDir(owner, repo);
  }

  /**
   * Get file path for repository state
   */
  getRepoFilePath(owner, repo, filename) {
    const dir = this.getRepoStorageDir(owner, repo);
    return path.join(dir, filename);
  }

  /**
   * Load state for a specific repository
   */
  async loadRepoState(owner, repo) {
    const key = this.getRepoKey(owner, repo);
    const repoState = this.state.get(key);

    if (repoState.loaded) return;

    try {
      const processedPrsPath = this.getRepoFilePath(owner, repo, 'processed_prs.json');
      const notificationCountsPath = this.getRepoFilePath(owner, repo, 'notification_counts.json');
      const processedTimestampsPath = this.getRepoFilePath(owner, repo, 'processed_timestamps.json');

      const [processedRaw, countsRaw, timestampsRaw] = await Promise.all([
        fs.readFile(processedPrsPath, 'utf8').catch(() => null),
        fs.readFile(notificationCountsPath, 'utf8').catch(() => null),
        fs.readFile(processedTimestampsPath, 'utf8').catch(() => null)
      ]);

      if (processedRaw) {
        const parsed = JSON.parse(processedRaw);
        parsed.forEach(id => repoState.processedPRs.add(id.toString()));
        logger.debug(`[${key}] Loaded ${repoState.processedPRs.size} processed PRs`);
      }

      if (countsRaw) {
        const parsed = JSON.parse(countsRaw);
        Object.entries(parsed).forEach(([id, count]) => repoState.notificationCount.set(id, count));
        logger.debug(`[${key}] Loaded notification counts for ${repoState.notificationCount.size} PRs`);
      }

      if (timestampsRaw) {
        const parsed = JSON.parse(timestampsRaw);
        Object.entries(parsed).forEach(([id, timestamp]) => repoState.processedTimestamps.set(id, timestamp));
        logger.debug(`[${key}] Loaded timestamps for ${repoState.processedTimestamps.size} PRs`);
      }

      repoState.loaded = true;
    } catch (err) {
      logger.error(`[${key}] Error loading state: ${err.message}`);
      repoState.loaded = true;
    }
  }

  /**
   * Save state for a specific repository
   */
  async saveRepoState(owner, repo) {
    const key = this.getRepoKey(owner, repo);
    const repoState = this.state.get(key);

    if (!repoState) {
      logger.warn(`[${key}] No state to save`);
      return;
    }

    try {
      const processedPrsPath = this.getRepoFilePath(owner, repo, 'processed_prs.json');
      const notificationCountsPath = this.getRepoFilePath(owner, repo, 'notification_counts.json');
      const processedTimestampsPath = this.getRepoFilePath(owner, repo, 'processed_timestamps.json');

      await Promise.all([
        fs.writeFile(processedPrsPath, JSON.stringify([...repoState.processedPRs], null, 2)),
        fs.writeFile(notificationCountsPath, JSON.stringify(Object.fromEntries(repoState.notificationCount), null, 2)),
        fs.writeFile(processedTimestampsPath, JSON.stringify(Object.fromEntries(repoState.processedTimestamps), null, 2))
      ]);

      logger.debug(`[${key}] State saved successfully`);
    } catch (err) {
      logger.error(`[${key}] Failed to save state: ${err.message}`);
      throw err;
    }
  }

  /**
   * Check if PR has been fully processed
   */
  async isProcessed(owner, repo, prId) {
    const repoState = await this.getRepoState(owner, repo);
    return repoState.processedPRs.has(prId.toString());
  }

  /**
   * Get current notification count for a PR
   */
  getNotificationCount(owner, repo, prId) {
    const repoState = this.getRepoStateSync(owner, repo);
    return repoState.notificationCount.get(prId.toString()) || 0;
  }

  /**
   * Increment notification counter for a PR
   */
  async incrementNotificationCount(owner, repo, prId) {
    const repoState = await this.getRepoState(owner, repo);
    const prIdStr = prId.toString();
    const current = this.getNotificationCount(owner, repo, prId);
    const newCount = current + 1;
    repoState.notificationCount.set(prIdStr, newCount);
    await this.saveRepoState(owner, repo);
    return newCount;
  }

  /**
   * Mark PR as processed
   */
  async markProcessed(owner, repo, prId) {
    const repoState = await this.getRepoState(owner, repo);
    const prIdStr = prId.toString();

    if (!repoState.processedPRs.has(prIdStr)) {
      repoState.processedPRs.add(prIdStr);
      repoState.processedTimestamps.set(prIdStr, Date.now());

      this.cleanupOldEntries(owner, repo);

      await this.saveRepoState(owner, repo);
      logger.info(`[${this.getRepoKey(owner, repo)}] Marked PR #${prId} as fully processed`);
    }
  }

  /**
   * Cleanup old entries from state to prevent unbounded growth
   */
  cleanupOldEntries(owner, repo, maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    const repoState = this.getRepoStateSync(owner, repo);
    const now = Date.now();
    let cleaned = 0;

    for (const prId of repoState.processedPRs) {
      const timestamp = repoState.processedTimestamps.get(prId);
      if (timestamp && (now - timestamp) > maxAgeMs) {
        repoState.processedPRs.delete(prId);
        repoState.processedTimestamps.delete(prId);
        repoState.notificationCount.delete(prId);
        cleaned++;
      }
    }

    for (const [prId] of repoState.notificationCount) {
      if (!repoState.processedPRs.has(prId)) {
        repoState.notificationCount.delete(prId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      const key = this.getRepoKey(owner, repo);
      logger.info(`[${key}] Cleaned up ${cleaned} old PR entries (older than ${maxAgeMs / 86400000} days)`);
    }

    return cleaned;
  }

  /**
   * Get statistics across all repositories
   */
  getStats() {
    const stats = {
      totalRepos: this.state.size,
      totalProcessedPRs: 0,
      totalNotifications: 0
    };

    for (const [key, repoState] of this.state.entries()) {
      stats.totalProcessedPRs += repoState.processedPRs.size;
      stats.totalNotifications += repoState.notificationCount.size;
    }

    return stats;
  }
}

module.exports = new RepositoryStateManager();
