const fs = require('fs/promises');
const config = require('../config');
const logger = require('../utils/logger');

class PRStateManager {
  constructor() {
    this.processedPRs = new Set();
    this.notificationCount = new Map(); // Track number of times notification was sent for a PR
    this.processedTimestamps = new Map(); // Track when PRs were last marked as processed
    this.loadProcessedPRs();
    this.loadNotificationCounts();
    this.loadProcessedTimestamps();
  }

  /**
   * Load processed PR IDs from persistent storage
   */
  async loadProcessedPRs() {
    try {
      const raw = await fs.readFile(config.storage.processedPrsPath, 'utf8');
      const parsed = JSON.parse(raw);
      parsed.forEach(id => this.processedPRs.add(id.toString()));
      logger.info(`Loaded ${this.processedPRs.size} previously processed PRs`);
    } catch (err) {
      logger.debug('No existing processed PR store, initializing new');
      await this.saveProcessedPRs();
    }
  }

  /**
   * Load notification send counts to track max 3x limit
   */
  async loadNotificationCounts() {
    try {
      const raw = await fs.readFile(config.storage.notificationCountsPath, 'utf8');
      const parsed = JSON.parse(raw);
      Object.entries(parsed).forEach(([id, count]) => this.notificationCount.set(id, count));
      logger.info(`Loaded notification counts for ${this.notificationCount.size} PRs`);
    } catch (err) {
      logger.debug('No existing notification count store, initializing new');
      await this.saveNotificationCounts();
    }
  }

  /**
   * Load processed timestamps from persistent storage
   */
  async loadProcessedTimestamps() {
    try {
      const raw = await fs.readFile(config.storage.processedTimestampsPath, 'utf8');
      const parsed = JSON.parse(raw);
      Object.entries(parsed).forEach(([id, timestamp]) => this.processedTimestamps.set(id, timestamp));
      logger.info(`Loaded processed timestamps for ${this.processedTimestamps.size} PRs`);
    } catch (err) {
      logger.debug('No existing processed timestamps store, initializing new');
      await this.saveProcessedTimestamps();
    }
  }

  /**
   * Save notification counts to disk
   */
  async saveNotificationCounts() {
    const data = JSON.stringify(Object.fromEntries(this.notificationCount), null, 2);
    await fs.writeFile(config.storage.notificationCountsPath, data);
  }

  /**
   * Save processed PRs to disk (idempotent operation)
   */
  async saveProcessedPRs() {
    const data = JSON.stringify([...this.processedPRs], null, 2);
    await fs.writeFile(config.storage.processedPrsPath, data);
  }

  /**
   * Save processed timestamps to disk
   */
  async saveProcessedTimestamps() {
    const data = JSON.stringify(Object.fromEntries(this.processedTimestamps), null, 2);
    await fs.writeFile(config.storage.processedTimestampsPath, data);
  }

  /**
   * Cleanup old entries from state to prevent unbounded growth
   * @param {number} maxAgeMs - Maximum age in milliseconds (default: 7 days)
   */
  cleanupOldEntries(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    const now = Date.now();
    let cleaned = 0;

    // Clean up processed PRs and their timestamps
    for (const prId of this.processedPRs) {
      const timestamp = this.processedTimestamps.get(prId);
      if (timestamp && (now - timestamp) > maxAgeMs) {
        this.processedPRs.delete(prId);
        this.processedTimestamps.delete(prId);
        this.notificationCount.delete(prId);
        cleaned++;
      }
    }

    // Also clean up notification counts for PRs no longer in processedPRs
    for (const [prId] of this.notificationCount) {
      if (!this.processedPRs.has(prId)) {
        this.notificationCount.delete(prId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} old PR entries from state (older than ${maxAgeMs / 86400000} days)`);
    }

    return cleaned;
  }

  /**
   * Check if PR has been fully processed to avoid duplicates
   */
  async isProcessed(prId) {
    return this.processedPRs.has(prId.toString());
  }

  /**
   * Get current notification count for a PR
   */
  getNotificationCount(prId) {
    const prIdStr = prId.toString();
    return this.notificationCount.get(prIdStr) || 0;
  }

  /**
   * Increment notification counter for a PR
   */
  async incrementNotificationCount(prId) {
    const prIdStr = prId.toString();
    const current = this.getNotificationCount(prId);
    const newCount = current + 1;
    this.notificationCount.set(prIdStr, newCount);
    await this.saveNotificationCounts();
    return newCount;
  }

  /**
   * Mark PR as processed (only writes if not already marked)
   */
  async markProcessed(prId) {
    const prIdStr = prId.toString();
    if (!this.processedPRs.has(prIdStr)) {
      this.processedPRs.add(prIdStr);
      this.processedTimestamps.set(prIdStr, Date.now());

      // Cleanup old entries before saving
      this.cleanupOldEntries();

      await this.saveProcessedPRs();
      await this.saveProcessedTimestamps();
      logger.info(`Marked PR #${prId} as fully processed`);
    }
  }
}

module.exports = new PRStateManager();
