const fs = require('fs/promises');
const config = require('../config');
const logger = require('../utils/logger');

class SkipManager {
  constructor() {
    this.skipCache = new Map();
    this.loadSkipCache();
  }

  /**
   * Load existing skip entries from disk
   */
  async loadSkipCache() {
    try {
      const raw = await fs.readFile(config.storage.skipCachePath, 'utf8');
      const parsed = JSON.parse(raw);
      Object.entries(parsed).forEach(([prId, expiryStr]) => {
        const expiry = new Date(expiryStr);
        if (new Date() < expiry) {
          this.skipCache.set(prId, expiryStr);
        }
      });
      logger.info(`Loaded ${this.skipCache.size} active PR skip entries`);
    } catch (err) {
      logger.debug('No existing skip cache, initializing new');
      await this.saveSkipCache();
    }
  }

  /**
   * Save skip cache to disk
   */
  async saveSkipCache() {
    const data = Object.fromEntries(this.skipCache);
    await fs.writeFile(config.storage.skipCachePath, JSON.stringify(data, null, 2));
  }

  /**
   * Add a PR to skip cache for configured duration
   */
  async addSkip(prId) {
    const expiry = new Date(Date.now() + config.scheduler.skipDurationMs);
    const prIdStr = prId.toString();
    this.skipCache.set(prIdStr, expiry.toISOString());
    await this.saveSkipCache();
    logger.info(`Added PR #${prId} to skip cache until ${expiry.toISOString()}`);
  }

  /**
   * Check if PR is currently skipped, cleanup expired entries automatically
   */
  isSkipped(prId) {
    this.cleanupExpiredEntries(); // Cleanup on every check
    const prIdStr = prId.toString();
    if (!this.skipCache.has(prIdStr)) return false;

    const expiry = new Date(this.skipCache.get(prIdStr));
    if (new Date() > expiry) {
      this.skipCache.delete(prIdStr);
      return false;
    }
    return true;
  }

  /**
   * Cleanup expired entries from the skip cache
   * This should be called periodically to prevent unbounded growth
   */
  cleanupExpiredEntries() {
    const now = new Date();
    let cleaned = 0;

    for (const [prId, expiryStr] of this.skipCache.entries()) {
      const expiry = new Date(expiryStr);
      if (now > expiry) {
        this.skipCache.delete(prId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} expired skip cache entries`);
      this.saveSkipCache(); // Save after cleanup
    }

    return cleaned;
  }
}

module.exports = new SkipManager();
