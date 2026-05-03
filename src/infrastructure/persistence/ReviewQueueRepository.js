/**
 * ReviewQueueRepository - Queue persistence
 *
 * Handles persistence of review queues to the file system with atomic writes
 * and in-memory caching for performance.
 *
 * @module infrastructure/persistence/ReviewQueueRepository
 */

const fs = require('fs').promises;
const path = require('path');
const ReviewQueue = require('../../core/entities/ReviewQueue');
const logger = require('../../utils/logger');

/**
 * ReviewQueueRepository - Persist and load review queues
 */
class ReviewQueueRepository {
  /**
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   */
  constructor(options = {}) {
    this.logger = options.logger || logger;
    this.dataDir = path.join(process.cwd(), 'data', 'instances');
    this.queues = new Map(); // In-memory cache
  }

  /**
   * Get file path for queue storage
   * @private
   * @param {string} instanceKey - GitHub instance key
   * @returns {string} File path
   */
  _getQueuePath(instanceKey) {
    const cleanKey = instanceKey.replace('github/', 'github-');
    const parts = cleanKey.split('/');
    const org = parts[0];
    return path.join(this.dataDir, org, 'review_queue.json');
  }

  /**
   * Get queue for an instance
   * @param {string} instanceKey - GitHub instance key
   * @returns {Promise<ReviewQueue|null>} Queue, or null if not exists
   */
  async getQueue(instanceKey) {
    // Check cache first
    if (this.queues.has(instanceKey)) {
      return this.queues.get(instanceKey);
    }

    const filePath = this._getQueuePath(instanceKey);

    try {
      const data = await fs.readFile(filePath, 'utf8');
      const json = JSON.parse(data);
      const queue = ReviewQueue.fromJSON(json);
      this.queues.set(instanceKey, queue);
      return queue;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Queue doesn't exist yet
        return null;
      }
      throw error;
    }
  }

  /**
   * Save queue to disk
   * @param {ReviewQueue} queue - Queue to save
   * @returns {Promise<void>}
   */
  async saveQueue(queue) {
    const filePath = this._getQueuePath(queue.instanceKey);
    const dir = path.dirname(filePath);

    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });

    // Write atomically (write to temp, then rename)
    const tempPath = `${filePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(queue.toJSON(), null, 2), 'utf8');
    await fs.rename(tempPath, filePath);

    // Update cache
    this.queues.set(queue.instanceKey, queue);

    this.logger.debug(`[ReviewQueueRepository] Saved queue for ${queue.instanceKey}`);
  }

  /**
   * Get all cached queues
   * @returns {Array<ReviewQueue>} All queues
   */
  getAllQueues() {
    return Array.from(this.queues.values());
  }

  /**
   * Load all queues from disk
   * @returns {Promise<Array<ReviewQueue>>} All queues
   */
  async loadAllQueues() {
    const queues = [];

    try {
      const orgs = await fs.readdir(this.dataDir);

      for (const org of orgs) {
        const queuePath = path.join(this.dataDir, org, 'review_queue.json');

        try {
          const data = await fs.readFile(queuePath, 'utf8');
          const json = JSON.parse(data);
          const queue = ReviewQueue.fromJSON(json);
          queues.push(queue);
          this.queues.set(queue.instanceKey, queue);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            this.logger.warn(`[ReviewQueueRepository] Failed to load queue from ${queuePath}:`, error.message);
          }
        }
      }
    } catch (error) {
      this.logger.error('[ReviewQueueRepository] Error reading queue directory:', error);
    }

    return queues;
  }

  /**
   * Delete queue from disk and cache
   * @param {string} instanceKey - GitHub instance key
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteQueue(instanceKey) {
    const filePath = this._getQueuePath(instanceKey);

    try {
      await fs.unlink(filePath);
      this.queues.delete(instanceKey);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Clear cache for an instance
   * @param {string} instanceKey - GitHub instance key
   */
  clearCache(instanceKey) {
    this.queues.delete(instanceKey);
  }

  /**
   * Clear all caches
   */
  clearAllCaches() {
    this.queues.clear();
  }
}

module.exports = ReviewQueueRepository;
