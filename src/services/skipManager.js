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
    const prIdStr = prId.toString();
    if (!this.skipCache.has(prIdStr)) return false;

    const expiry = new Date(this.skipCache.get(prIdStr));
    if (new Date() > expiry) {
      this.skipCache.delete(prIdStr);
      this.saveSkipCache(); // Cleanup expired entry
      return false;
    }
    return true;
  }
}

module.exports = new SkipManager();
