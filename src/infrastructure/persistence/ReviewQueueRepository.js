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
const lockfile = require('proper-lockfile');
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
      if (!json) {
        return null;
      }
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
   * Execute a function with an exclusive lock for the given instance.
   * Reads fresh from disk (bypasses cache), runs the callback, saves the result.
   *
   * @param {string} instanceKey - GitHub instance key
   * @param {Function} fn - Async callback: (queue: ReviewQueue|null) => ReviewQueue|{save: ReviewQueue}|any
   *   Return a ReviewQueue to save it, { save: ReviewQueue, ...data } to save and return extra data,
   *   or any other value to skip saving.
   * @param {Object} options - Lock options
   * @param {number} options.stale - Stale lock age in ms (default: 15000)
   * @returns {Promise<*>} Whatever fn() returns
   */
  async withInstanceLock(instanceKey, fn, options = {}) {
    const queuePath = this._getQueuePath(instanceKey);
    const dir = path.dirname(queuePath);
    await fs.mkdir(dir, { recursive: true });

    // proper-lockfile requires the target file to exist
    try {
      await fs.access(queuePath);
    } catch {
      await fs.writeFile(queuePath, 'null', 'utf8');
    }

    const release = await lockfile.lock(queuePath, {
      lockfilePath: `${queuePath}.lock`,
      stale: options.stale || 15000,
      retries: { retries: 5, minTimeout: 200, maxTimeout: 2000 }
    });

    try {
      // Bypass cache, read fresh from disk
      this.queues.delete(instanceKey);
      const queue = await this.getQueue(instanceKey);

      const result = await fn(queue);

      // Determine if we need to save
      let toSave = null;
      if (result instanceof ReviewQueue) {
        toSave = result;
      } else if (result?.save instanceof ReviewQueue) {
        toSave = result.save;
      }

      if (toSave) {
        await this.saveQueue(toSave);
      }

      return result;
    } finally {
      await release();
    }
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
          if (!json) {
            this.logger.debug(`[ReviewQueueRepository] Empty queue file at ${queuePath}, skipping`);
            continue;
          }
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
