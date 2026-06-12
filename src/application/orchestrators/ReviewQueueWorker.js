/**
 * ReviewQueueWorker - Background queue processing worker
 *
 * Continuously polls for queued review items and processes them one at a time.
 * Handles recovery of interrupted items and graceful shutdown.
 *
 * Uses file locking to ensure only ONE process runs the worker.
 * Multiple instances can coexist, but only the lock holder will poll.
 *
 * @module application/orchestrators/ReviewQueueWorker
 */

const fs = require('fs');
const path = require('path');

// File lock path - ensures only one process runs the worker
const LOCK_FILE = path.join(process.cwd(), 'data', '.review-queue-worker.lock');

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
    this.discordAdapter = options.discordAdapter || null;
    this.reviewPromptBuilder = options.reviewPromptBuilder || null;
    this.externalReviewSessionService = options.externalReviewSessionService || null;

    this.isRunning = false;
    this._workerTimer = null;
    this._isProcessing = false;

    // Singleton lock
    this.lockFd = null;
    this.isWorkerOwner = false;
    this._ensureLockDir();
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

    if (!this._acquireWorkerLock()) {
      this.logger.info('[ReviewQueueWorker] Another worker owns lock, skipping');
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

    this._releaseWorkerLock();
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

    // Get instance and repo config (before try so catch can access)
    const config = require('../../config/yamlConfig');
    const instance = config.instances[queue.instanceKey];
    const repoConfig = instance?.repos?.[item.repoName];

    try {
      this.logger.info(
        `[ReviewQueueWorker] Processing ${item.instanceKey}/${item.repoName} PR #${item.prNumber} (${item.level})`
      );

      if (!repoConfig) {
        throw new Error(`Repo config not found: ${item.repoName}`);
      }

      if (!repoConfig) {
        throw new Error(`Repo config not found: ${item.repoName}`);
      }

      await this.eventBus.emitAsync('queue.item.started', {
        instanceKey: queue.instanceKey,
        itemId: item.id,
        repoName: item.repoName,
        prNumber: item.prNumber,
        prTitle: item.prTitle,
        level: item.level,
        threadId: repoConfig.thread_id
      });

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

      const reviewMode = config.app?.discord?.reviewMode || 'mention_hermes';
      const result = reviewMode === 'handoff_reply_submit'
        ? await this._processExternalHandoff(instance, repo, pr, item, githubAdapter)
        : await this.reviewPRUseCase.execute(
          instance,
          repo,
          pr,
          item.level,
          githubAdapter
        );

      const duration = Date.now() - startTime;

      // Handle non-success result (use case catches errors, doesn't throw)
      if (!result?.success) {
        const err = new Error(result?.error || 'Review execution failed');

        const failureResult = await this.queueUseCase.handleProcessingFailure(
          queue.instanceKey,
          item.id,
          err
        );

        // If item was requeued for retry, don't emit failed event
        if (failureResult?.requeued) {
          this.logger.warn(
            `[ReviewQueueWorker] Transient failure for ${item.instanceKey}/${item.repoName} PR #${item.prNumber}, requeued for retry: ${err.message}`
          );
          return;
        }

        // Final failure - emit failed event for notification
        await this.eventBus.emitAsync('queue.item.failed', {
          instanceKey: queue.instanceKey,
          itemId: item.id,
          error: err.message,
          duration,
          repoName: item.repoName,
          prNumber: item.prNumber,
          prTitle: item.prTitle,
          level: item.level,
          threadId: repoConfig.thread_id
        });

        this.logger.error(
          `[ReviewQueueWorker] Final failure for ${item.instanceKey}/${item.repoName} PR #${item.prNumber}: ${err.message}`
        );

        return;
      }

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
        duration,
        repoName: item.repoName,
        prNumber: item.prNumber,
        prTitle: item.prTitle,
        level: item.level,
        threadId: repoConfig.thread_id,
        reviewUrl: result.review?.html_url
      });

      this.logger.info(
        `[ReviewQueueWorker] Completed ${item.instanceKey}/${item.repoName} PR #${item.prNumber} in ${duration}ms`
      );

    } catch (error) {
      this.logger.error(
        `[ReviewQueueWorker] Error processing ${item.id}:`,
        error
      );

      const failureResult = await this.queueUseCase.handleProcessingFailure(
        queue.instanceKey,
        item.id,
        error
      );

      // If item was requeued for retry, don't emit failed event
      if (failureResult?.requeued) {
        this.logger.warn(
          `[ReviewQueueWorker] Transient failure for ${item.instanceKey}/${item.repoName} PR #${item.prNumber}, requeued for retry: ${error.message}`
        );
        return;
      }

      // Final failure - emit failed event for notification
      await this.eventBus.emitAsync('queue.item.failed', {
        instanceKey: queue.instanceKey,
        itemId: item.id,
        error: error.message,
        duration: Date.now() - startTime,
        repoName: item.repoName,
        prNumber: item.prNumber,
        prTitle: item.prTitle,
        level: item.level,
        threadId: repoConfig?.thread_id
      });
    }
  }

  async _processExternalHandoff(instance, repo, pr, item, githubAdapter) {
    if (!this.discordAdapter || !this.reviewPromptBuilder || !this.externalReviewSessionService) {
      throw new Error('External handoff dependencies are not available');
    }

    const freshPR = await this._resolveFreshPR(pr, repo, githubAdapter);
    const { previousComments, lastCommits } = await this._loadPromptContext(githubAdapter, repo.name, freshPR.number);
    const config = require('../../config/yamlConfig');
    const levelConfig = config.reviewLevels?.[item.level];
    const prompt = this.reviewPromptBuilder.build({
      owner: instance.owner,
      repo: repo.name,
      pr: freshPR,
      level: item.level,
      levelConfig,
      mcpName: instance.mcpName || 'github',
      previousComments,
      lastCommits
    });
    const handoffPrompt = this.reviewPromptBuilder.buildDiscordHandoff({
      mentionBotName: instance.mentionBotName,
      basePrompt: prompt
    });

    const trigger = await this.discordAdapter.sendHermesMention({
      instance,
      repo,
      mentionBotName: instance.mentionBotName,
      content: handoffPrompt.triggerContent
    });

    this.externalReviewSessionService.startSession({
      queueItemId: item.id,
      instanceKey: item.instanceKey,
      repoName: item.repoName,
      prNumber: item.prNumber,
      level: item.level,
      triggerMessageId: trigger.id,
      trustedBotUserId: instance.mentionBotUserId,
      timeoutMs: (instance.agent?.reviewTimeoutSeconds || 600) * 1000
    });

    const promptRequestMessage = await this.externalReviewSessionService.awaitPromptRequest(item.id);
    if (promptRequestMessage) {
      await this.discordAdapter.sendReplyChunks(
        promptRequestMessage,
        handoffPrompt.detailContent,
        { prefix: 'Prompt review' }
      );
    }

    const externalResult = await this.externalReviewSessionService.awaitResult(item.id);

    return this.reviewPRUseCase.submitExternalResult(
      instance,
      repo,
      freshPR,
      item.level,
      externalResult.reviewResult,
      githubAdapter
    );
  }

  async _resolveFreshPR(pr, repo, githubAdapter) {
    const openPRs = await githubAdapter.getOpenPRs(repo.name);
    const freshPR = openPRs.find(candidate => candidate.number === pr.number || String(candidate.id) === String(pr.id));

    if (!freshPR) {
      throw new Error(`Could not load fresh PR #${pr.number} for ${repo.name}`);
    }

    return freshPR;
  }

  async _loadPromptContext(githubAdapter, repoName, prNumber) {
    const [previousComments, lastCommits] = await Promise.all([
      githubAdapter.getPRComments(repoName, prNumber).catch(() => []),
      githubAdapter.getPRCommits(repoName, prNumber, 3).catch(() => [])
    ]);

    return { previousComments, lastCommits };
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
      if (!queue.currentItem) continue;

      const item = queue.currentItem;
      const elapsed = Date.now() - new Date(item.startedAt).getTime();

      if (elapsed > timeout) {
        this.logger.warn(
          `[ReviewQueueWorker] Found timed out item ${item.id} for ${queue.instanceKey}`
        );

        // handleProcessingFailure acquires its own lock -- call OUTSIDE withInstanceLock
        await this.queueUseCase.handleProcessingFailure(
          queue.instanceKey,
          item.id,
          new Error('Processing timeout - recovery')
        );
      } else {
        // Requeue -- use withInstanceLock for atomic read-modify-write
        await this.queueRepository.withInstanceLock(
          queue.instanceKey,
          async (freshQueue) => {
            if (!freshQueue?.currentItem) return null;
            const freshItem = freshQueue.currentItem;
            freshQueue.currentItem = null;
            freshQueue.status = 'idle';
            freshQueue.items.unshift(freshItem);
            return freshQueue;
          }
        );

        this.logger.info(
          `[ReviewQueueWorker] Requeued interrupted item ${item.id} for ${queue.instanceKey}`
        );
      }
    }
  }

  /**
   * Ensure lock directory exists
   * @private
   */
  _ensureLockDir() {
    const lockDir = path.dirname(LOCK_FILE);
    if (!fs.existsSync(lockDir)) {
      fs.mkdirSync(lockDir, { recursive: true });
    }
  }

  /**
   * Try to acquire the worker lock
   * Returns true if lock acquired, false otherwise
   * @private
   */
  _acquireWorkerLock() {
    try {
      this.lockFd = fs.openSync(LOCK_FILE, 'wx');
      fs.writeSync(this.lockFd, String(process.pid));
      this.isWorkerOwner = true;
      this.logger.info(`[ReviewQueueWorker] Acquired worker lock (PID: ${process.pid})`);
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') {
        try {
          const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim());
          process.kill(pid, 0);
          this.logger.info(`[ReviewQueueWorker] Lock held by PID ${pid}, skipping`);
          return false;
        } catch (readErr) {
          if (readErr.code === 'ESRCH' || readErr.code === 'ENOENT') {
            try {
              fs.unlinkSync(LOCK_FILE);
              this.lockFd = fs.openSync(LOCK_FILE, 'wx');
              fs.writeSync(this.lockFd, String(process.pid));
              this.isWorkerOwner = true;
              this.logger.info(`[ReviewQueueWorker] Cleaned stale lock, acquired worker lock (PID: ${process.pid})`);
              return true;
            } catch (retryErr) {
              this.logger.warn(`[ReviewQueueWorker] Could not acquire lock after cleanup: ${retryErr.message}`);
              return false;
            }
          }
          return false;
        }
      }
      this.logger.warn(`[ReviewQueueWorker] Lock acquisition error: ${err.message}`);
      return false;
    }
  }

  /**
   * Release the worker lock
   * @private
   */
  _releaseWorkerLock() {
    try {
      if (this.lockFd !== null) {
        fs.closeSync(this.lockFd);
        this.lockFd = null;
      }
      if (fs.existsSync(LOCK_FILE)) {
        fs.unlinkSync(LOCK_FILE);
      }
      this.isWorkerOwner = false;
      this.logger.info('[ReviewQueueWorker] Released worker lock');
    } catch (err) {
      this.logger.warn(`[ReviewQueueWorker] Lock release error: ${err.message}`);
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
