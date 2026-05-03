/**
 * ReviewQueue - Per-instance queue entity
 *
 * Manages a FIFO queue of review requests for a single GitHub instance.
 * Provides business logic for queue operations, state transitions, and statistics.
 *
 * @module core/entities/ReviewQueue
 */

const QueueItem = require('./QueueItem');

class ReviewQueue {
  /**
   * Create a new ReviewQueue
   * @param {string} instanceKey - GitHub instance key (e.g., 'github/hinha')
   * @param {number} maxSize - Maximum number of items in queue
   */
  constructor(instanceKey, maxSize = 2) {
    this.instanceKey = instanceKey;
    this.maxSize = maxSize;
    this.status = 'idle'; // idle, processing, paused
    this.currentItem = null;
    this.items = [];
    this.stats = {
      totalProcessed: 0,
      totalFailed: 0,
      averageProcessingTime: 0
    };
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Add item to queue
   * @param {QueueItem} item - Item to enqueue
   * @returns {QueueItem} Enqueued item
   * @throws {Error} If queue is full
   */
  enqueue(item) {
    if (this.isFull()) {
      throw new Error(`Queue is full (max: ${this.maxSize})`);
    }
    this.items.push(item);
    this.updatedAt = new Date().toISOString();
    return item;
  }

  /**
   * Remove and return next item from queue
   * @returns {QueueItem|null} Next item, or null if empty
   */
  dequeue() {
    if (this.items.length === 0) {
      return null;
    }
    const item = this.items.shift();
    this.updatedAt = new Date().toISOString();
    return item;
  }

  /**
   * View next item without removing it
   * @returns {QueueItem|null} Next item, or null if empty
   */
  peek() {
    return this.items[0] || null;
  }

  /**
   * Get position of an item in the queue
   * @param {string} itemId - Item ID
   * @returns {number} Position (1-indexed), or 0 if not found
   */
  getPosition(itemId) {
    return this.items.findIndex(item => item.id === itemId) + 1;
  }

  /**
   * Check if queue is full
   * @returns {boolean} True if at max capacity
   */
  isFull() {
    return this.items.length >= this.maxSize;
  }

  /**
   * Check if queue is empty (no items and no current item)
   * @returns {boolean} True if empty
   */
  isEmpty() {
    return this.items.length === 0 && !this.currentItem;
  }

  /**
   * Check if queue can process next item
   * @returns {boolean} True if ready to process
   */
  canProcess() {
    return !this.currentItem && this.items.length > 0 && this.status !== 'paused';
  }

  /**
   * Get estimated wait time for new items
   * @returns {number|null} Estimated wait time in ms, or null if unknown
   */
  getEstimatedWaitTime() {
    if (this.isEmpty() || this.stats.averageProcessingTime === 0) {
      return null;
    }
    // Include current item if processing
    const pendingCount = this.items.length + (this.currentItem ? 1 : 0);
    return pendingCount * this.stats.averageProcessingTime;
  }

  /**
   * Start processing an item
   * @param {QueueItem} item - Item to process
   */
  startProcessing(item) {
    this.currentItem = item;
    this.status = 'processing';
    item.markAsProcessing();
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Complete processing of current item
   * @param {QueueItem} item - Item that was processed
   * @param {boolean} success - Whether processing succeeded
   */
  completeProcessing(item, success = true) {
    this.currentItem = null;
    if (success) {
      this.stats.totalProcessed++;
      item.markAsCompleted();
    } else {
      this.stats.totalFailed++;
      item.markAsFailed(item.error);
    }
    this.status = 'idle';
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Pause queue (stop processing new items)
   */
  pause() {
    this.status = 'paused';
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Resume queue (allow processing)
   */
  resume() {
    this.status = 'idle';
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Update average processing time
   * @param {number} duration - Processing duration in ms
   */
  updateAverageProcessingTime(duration) {
    const total = this.stats.totalProcessed + this.stats.totalFailed;
    if (total === 0) {
      this.stats.averageProcessingTime = duration;
    } else {
      this.stats.averageProcessingTime =
        (this.stats.averageProcessingTime * (total - 1) + duration) / total;
    }
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Get all items including current
   * @returns {Array<QueueItem>} All items
   */
  getAllItems() {
    const all = [...this.items];
    if (this.currentItem) {
      all.unshift(this.currentItem);
    }
    return all;
  }

  /**
   * Clear all queued items (keep stats)
   */
  clear() {
    this.items = [];
    this.currentItem = null;
    this.status = 'idle';
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Serialize to JSON
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      instanceKey: this.instanceKey,
      maxSize: this.maxSize,
      status: this.status,
      currentItem: this.currentItem ? this.currentItem.toJSON() : null,
      items: this.items.map(item => item.toJSON()),
      stats: this.stats,
      updatedAt: this.updatedAt
    };
  }

  /**
   * Deserialize from JSON
   * @param {Object} json - JSON representation
   * @returns {ReviewQueue} ReviewQueue instance
   */
  static fromJSON(json) {
    const queue = new ReviewQueue(json.instanceKey, json.maxSize);
    queue.status = json.status;
    queue.currentItem = json.currentItem ? QueueItem.fromJSON(json.currentItem) : null;
    queue.items = json.items.map(item => QueueItem.fromJSON(item));
    queue.stats = json.stats;
    queue.updatedAt = json.updatedAt;
    return queue;
  }
}

module.exports = ReviewQueue;
