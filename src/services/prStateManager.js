const fs = require('fs/promises');
const config = require('../config');
const logger = require('../utils/logger');

class PRStateManager {
  constructor() {
    this.processedPRs = new Set();
    this.notificationCount = new Map(); // Track number of times notification was sent for a PR
    this.loadProcessedPRs();
    this.loadNotificationCounts();
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
      await this.saveProcessedPRs();
      logger.info(`Marked PR #${prId} as fully processed`);
    }
  }
}

module.exports = new PRStateManager();
