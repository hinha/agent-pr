/**
 * ReviewQueueWorker - Background queue processing worker
 *
 * Continuously polls for queued review items and processes them one at a time.
 * Handles recovery of interrupted items and graceful shutdown.
 *
 * @module application/orchestrators/ReviewQueueWorker
 */

/**
 * ReviewQueueWorker - Process queued reviews in background
 */
class ReviewQueueWorker {
  /**
   * @param {Object} queueRepository - Queue repository
   * @param {Object} queueUseCase - Queue use case
   * @param {Object} reviewPRUseCase - Review PR use case
   * @param {Object} eventBus - Event bus
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   * @param {number} options.pollInterval - Poll interval in ms
   * @param {Object} options.githubAdapterFactory - GitHub adapter factory
   */
  constructor(queueRepository, queueUseCase, reviewPRUseCase, eventBus, options = {}) {
    this.queueRepository = queueRepository;
    this.queueUseCase = queueUseCase;
    this.reviewPRUseCase = reviewPRUseCase;
    this.eventBus = eventBus;
    this.logger = options.logger || console;
    this.pollInterval = options.pollInterval || 5000;
    this.githubAdapterFactory = options.githubAdapterFactory;

    this.isRunning = false;
    this._workerTimer = null;
    this._isProcessing = false;
  }

  /**
   * Start the worker
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn('[ReviewQueueWorker] Already running');
      return;
    }

    this.isRunning = true;
    this.logger.info('[ReviewQueueWorker] Starting...');

    // Recover interrupted items
    await this._recoverInterruptedItems();

    // Start worker loop
    this._workerTimer = setInterval(() => {
      this._poll().catch(err => {
        this.logger.error('[ReviewQueueWorker] Poll error:', err);
      });
    }, this.pollInterval);

    this.logger.info('[ReviewQueueWorker] Started');
  }

  /**
   * Stop the worker gracefully
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    this.logger.info('[ReviewQueueWorker] Stopping...');
    this.isRunning = false;

    if (this._workerTimer) {
      clearInterval(this._workerTimer);
      this._workerTimer = null;
    }

    // Wait for current processing to finish
    while (this._isProcessing) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.logger.info('[ReviewQueueWorker] Stopped');
  }

  /**
   * Poll for items to process
   * @private
   * @returns {Promise<void>}
   */
  async _poll() {
    if (this._isProcessing || !this.isRunning) {
      return;
    }

    try {
      // Get all queues
      const queues = await this.queueRepository.loadAllQueues();

      for (const queue of queues) {
        if (!queue.canProcess()) {
          continue;
        }

        // Dequeue next item
        const result = await this.queueUseCase.dequeueForProcessing(queue.instanceKey);
        if (!result) {
          continue;
        }

        const { queue: updatedQueue, item } = result;

        // Process item in background
        this._isProcessing = true;
        this._processItem(updatedQueue, item)
          .finally(() => {
            this._isProcessing = false;
          });

        break; // Process one at a time globally
      }
    } catch (error) {
      this.logger.error('[ReviewQueueWorker] Error in poll:', error);
    }
  }

  /**
   * Process a single queue item
   * @private
   * @param {Object} queue - Queue object
   * @param {Object} item - QueueItem to process
   * @returns {Promise<void>}
   */
  async _processItem(queue, item) {
    const startTime = Date.now();

    try {
      this.logger.info(
        `[ReviewQueueWorker] Processing ${item.instanceKey}/${item.repoName} PR #${item.prNumber} (${item.level})`
      );

      await this.eventBus.emitAsync('queue.item.started', {
        instanceKey: queue.instanceKey,
        itemId: item.id
      });

      // Get instance and repo config
      const config = require('../../config/yamlConfig');
      const instance = config.instances[queue.instanceKey];
      const repoConfig = instance.repos[item.repoName];

      if (!repoConfig) {
        throw new Error(`Repo config not found: ${item.repoName}`);
      }

      // Create PR entity
      const PullRequest = require('../../core/entities/PullRequest');
      const pr = new PullRequest({
        id: parseInt(item.prId, 10),
        number: item.prNumber,
        title: item.prTitle
      });

      const repo = {
        name: item.repoName,
        threadId: repoConfig.thread_id,
        instanceKey: queue.instanceKey
      };

      // Create GitHub adapter
      const githubAdapter = this.githubAdapterFactory.create(queue.instanceKey);

      // Execute review
      const result = await this.reviewPRUseCase.execute(
        instance,
        repo,
        pr,
        item.level,
        githubAdapter
      );

      const duration = Date.now() - startTime;

      // Complete processing
      await this.queueUseCase.completeProcessing(
        queue.instanceKey,
        item.id,
        result,
        duration
      );

      await this.eventBus.emitAsync('queue.item.completed', {
        instanceKey: queue.instanceKey,
        itemId: item.id,
        duration
      });

      this.logger.info(
        `[ReviewQueueWorker] Completed ${item.instanceKey}/${item.repoName} PR #${item.prNumber} in ${duration}ms`
      );

    } catch (error) {
      this.logger.error(
        `[ReviewQueueWorker] Error processing ${item.id}:`,
        error
      );

      await this.queueUseCase.handleProcessingFailure(
        queue.instanceKey,
        item.id,
        error
      );

      await this.eventBus.emitAsync('queue.item.failed', {
        instanceKey: queue.instanceKey,
        itemId: item.id,
        error: error.message
      });
    }
  }

  /**
   * Recover items that were processing when worker stopped
   * @private
   * @returns {Promise<void>}
   */
  async _recoverInterruptedItems() {
    this.logger.info('[ReviewQueueWorker] Checking for interrupted items...');

    const queues = await this.queueRepository.loadAllQueues();
    const timeout = 30 * 60 * 1000; // 30 minutes

    for (const queue of queues) {
      if (queue.currentItem) {
        const item = queue.currentItem;
        const elapsed = Date.now() - new Date(item.startedAt).getTime();

        if (elapsed > timeout) {
          this.logger.warn(
            `[ReviewQueueWorker] Found timed out item ${item.id} for ${queue.instanceKey}`
          );

          await this.queueUseCase.handleProcessingFailure(
            queue.instanceKey,
            item.id,
            new Error('Processing timeout - recovery')
          );
        } else {
          this.logger.info(
            `[ReviewQueueWorker] Found active item ${item.id} for ${queue.instanceKey}, will continue processing`
          );
        }
      }
    }
  }

  /**
   * Get worker status
   * @returns {Object} Worker status
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isProcessing: this._isProcessing,
      pollInterval: this.pollInterval
    };
  }
}

module.exports = ReviewQueueWorker;
