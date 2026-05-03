/**
 * ReviewQueueUseCase - Queue management orchestration
 *
 * Orchestrates queue operations including enqueueing, status checking,
 * cancellation, and processing lifecycle management.
 *
 * @module application/use-cases/ReviewQueueUseCase
 */

const ReviewQueue = require('../../core/entities/ReviewQueue');
const QueueItem = require('../../core/entities/QueueItem');

/**
 * ReviewQueueUseCase - Manage review queues
 */
class ReviewQueueUseCase {
  /**
   * @param {Object} queueRepository - Queue repository
   * @param {Object} eventBus - Event bus
   * @param {Object} options - Configuration options
   */
  constructor(queueRepository, eventBus, options = {}) {
    this.queueRepository = queueRepository;
    this.eventBus = eventBus;
    this.logger = options.logger || console;
    this.config = options.config || {};
  }

  /**
   * Enqueue a review request
   * @param {Object} instance - GitHub instance config
   * @param {Object} repo - Repository config
   * @param {Object} pr - Pull request entity
   * @param {string} level - Review level (low, medium, high)
   * @returns {Promise<Object>} Enqueue result
   */
  async enqueueReview(instance, repo, pr, level) {
    const instanceKey = instance.key;

    // Get or create queue
    let queue = await this.queueRepository.getQueue(instanceKey);
    if (!queue) {
      const maxSize = instance.queue?.maxSize || 2;
      queue = new ReviewQueue(instanceKey, maxSize);
    }

    // Check if full
    if (queue.isFull()) {
      return {
        success: false,
        error: 'Queue is full',
        maxSize: queue.maxSize,
        currentSize: queue.items.length
      };
    }

    // Create queue item
    const item = new QueueItem({
      instanceKey,
      repoName: repo.name,
      prId: pr.id?.toString(),
      prNumber: pr.number,
      prTitle: pr.title,
      level
    });

    // Enqueue
    queue.enqueue(item);
    await this.queueRepository.saveQueue(queue);

    // Emit event
    await this.eventBus.emitAsync('queue.item.enqueued', {
      instanceKey,
      itemId: item.id,
      position: queue.getPosition(item.id)
    });

    this.logger.info(
      `[ReviewQueueUseCase] Enqueued review for ${instanceKey}/${repo.name} PR #${pr.number} (${level})`
    );

    return {
      success: true,
      item,
      position: queue.getPosition(item.id),
      estimatedWaitTime: queue.getEstimatedWaitTime(),
      queueSize: queue.items.length
    };
  }

  /**
   * Get queue status
   * @param {string} instanceKey - GitHub instance key
   * @returns {Promise<Object>} Queue status
   */
  async getQueueStatus(instanceKey) {
    const queue = await this.queueRepository.getQueue(instanceKey);
    if (!queue) {
      return { exists: false };
    }

    return {
      exists: true,
      instanceKey: queue.instanceKey,
      status: queue.status,
      currentItem: queue.currentItem ? queue.currentItem.toJSON() : null,
      items: queue.items.map(item => item.toJSON()),
      size: queue.items.length,
      maxSize: queue.maxSize,
      isFull: queue.isFull(),
      isEmpty: queue.isEmpty(),
      stats: queue.stats
    };
  }

  /**
   * Cancel a queued item
   * @param {string} instanceKey - GitHub instance key
   * @param {string} itemId - Item ID
   * @returns {Promise<Object>} Cancel result
   */
  async cancelQueueItem(instanceKey, itemId) {
    const queue = await this.queueRepository.getQueue(instanceKey);
    if (!queue) {
      return { success: false, error: 'Queue not found' };
    }

    const index = queue.items.findIndex(item => item.id === itemId);
    if (index === -1) {
      return { success: false, error: 'Item not found' };
    }

    const item = queue.items.splice(index, 1)[0];
    await this.queueRepository.saveQueue(queue);

    await this.eventBus.emitAsync('queue.item.cancelled', {
      instanceKey,
      itemId
    });

    this.logger.info(
      `[ReviewQueueUseCase] Cancelled item ${itemId} for ${instanceKey}`
    );

    return { success: true, item };
  }

  /**
   * Pause queue processing
   * @param {string} instanceKey - GitHub instance key
   * @returns {Promise<Object>} Pause result
   */
  async pauseQueue(instanceKey) {
    const queue = await this.queueRepository.getQueue(instanceKey);
    if (!queue) {
      return { success: false, error: 'Queue not found' };
    }

    queue.pause();
    await this.queueRepository.saveQueue(queue);

    await this.eventBus.emitAsync('queue.paused', { instanceKey });

    this.logger.info(`[ReviewQueueUseCase] Paused queue for ${instanceKey}`);

    return { success: true };
  }

  /**
   * Resume queue processing
   * @param {string} instanceKey - GitHub instance key
   * @returns {Promise<Object>} Resume result
   */
  async resumeQueue(instanceKey) {
    const queue = await this.queueRepository.getQueue(instanceKey);
    if (!queue) {
      return { success: false, error: 'Queue not found' };
    }

    queue.resume();
    await this.queueRepository.saveQueue(queue);

    await this.eventBus.emitAsync('queue.resumed', { instanceKey });

    this.logger.info(`[ReviewQueueUseCase] Resumed queue for ${instanceKey}`);

    return { success: true };
  }

  /**
   * Dequeue next item for processing
   * @param {string} instanceKey - GitHub instance key
   * @returns {Promise<Object|null>} Queue and item, or null if nothing to process
   */
  async dequeueForProcessing(instanceKey) {
    const queue = await this.queueRepository.getQueue(instanceKey);
    if (!queue) {
      return null;
    }

    if (!queue.canProcess()) {
      return null;
    }

    const item = queue.dequeue();
    if (!item) {
      return null;
    }

    queue.startProcessing(item);
    await this.queueRepository.saveQueue(queue);

    return { queue, item };
  }

  /**
   * Complete processing of an item
   * @param {string} instanceKey - GitHub instance key
   * @param {string} itemId - Item ID
   * @param {Object} result - Processing result
   * @param {number} duration - Processing duration in ms
   * @returns {Promise<Object>} Complete result
   */
  async completeProcessing(instanceKey, itemId, result, duration) {
    const queue = await this.queueRepository.getQueue(instanceKey);
    if (!queue) {
      return { success: false, error: 'Queue not found' };
    }

    const item = queue.currentItem;
    if (!item || item.id !== itemId) {
      return { success: false, error: 'Item not found as current' };
    }

    queue.completeProcessing(item, result.success);
    queue.updateAverageProcessingTime(duration);
    await this.queueRepository.saveQueue(queue);

    this.logger.info(
      `[ReviewQueueUseCase] Completed processing ${itemId} for ${instanceKey} (${duration}ms)`
    );

    return { success: true };
  }

  /**
   * Handle processing failure
   * @param {string} instanceKey - GitHub instance key
   * @param {string} itemId - Item ID
   * @param {Error} error - Error that occurred
   * @returns {Promise<Object>} Handle result with requeued flag
   */
  async handleProcessingFailure(instanceKey, itemId, error) {
    const queue = await this.queueRepository.getQueue(instanceKey);
    if (!queue) {
      return { success: false };
    }

    const item = queue.currentItem;
    if (!item || item.id !== itemId) {
      return { success: false };
    }

    item.retryCount = (item.retryCount || 0) + 1;

    const maxRetries = this.config.app?.review_queue?.max_retries || 2;

    if (item.retryCount < maxRetries && this._isTransientError(error)) {
      // Requeue with delay
      queue.currentItem = null;
      queue.status = 'idle';
      queue.items.unshift(item); // Add to front

      await this.queueRepository.saveQueue(queue);

      this.logger.warn(
        `[ReviewQueueUseCase] Requeued item ${itemId} for ${instanceKey} (retry ${item.retryCount}/${maxRetries})`
      );

      return { success: true, requeued: true };
    }

    // Mark as failed
    item.error = error.message;
    queue.completeProcessing(item, false);
    await this.queueRepository.saveQueue(queue);

    this.logger.error(
      `[ReviewQueueUseCase] Failed to process item ${itemId} for ${instanceKey}:`,
      error.message
    );

    return { success: true, requeued: false };
  }

  /**
   * Check if error is transient (should retry)
   * @private
   * @param {Error} error - Error to check
   * @returns {boolean} True if transient
   */
  _isTransientError(error) {
    const transientPatterns = [
      /timeout/i,
      /network/i,
      /ECONNREFUSED/i,
      /ETIMEDOUT/i,
      /rate limit/i
    ];
    return transientPatterns.some(pattern => pattern.test(error.message));
  }

  /**
   * Get all queue statuses
   * @returns {Promise<Array<Object>>} All queue statuses
   */
  async getAllQueueStatuses() {
    const queues = await this.queueRepository.loadAllQueues();
    return queues.map(queue => ({
      instanceKey: queue.instanceKey,
      status: queue.status,
      size: queue.items.length,
      maxSize: queue.maxSize,
      isFull: queue.isFull(),
      currentItem: queue.currentItem ? queue.currentItem.toJSON() : null,
      stats: queue.stats
    }));
  }

  /**
   * Clear all queues (for testing/resets)
   * @returns {Promise<void>}
   */
  async clearAllQueues() {
    const queues = await this.queueRepository.loadAllQueues();

    for (const queue of queues) {
      await this.queueRepository.deleteQueue(queue.instanceKey);
    }

    this.logger.info('[ReviewQueueUseCase] Cleared all queues');
  }
}

module.exports = ReviewQueueUseCase;
