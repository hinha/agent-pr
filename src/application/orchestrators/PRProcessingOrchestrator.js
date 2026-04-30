/**
 * PRProcessingOrchestrator - Main orchestrator for PR processing workflow
 *
 * This orchestrator coordinates the entire PR monitoring and processing workflow:
 * 1. Poll for open PRs across all instances/repos
 * 2. Filter PRs that need processing
 * 3. Execute review use cases for new PRs
 * 4. Check for outdated reviews (with snooze support)
 * 5. Handle graceful shutdown
 *
 * @example
 * const orchestrator = new PRProcessingOrchestrator(useCases, config, eventBus);
 * await orchestrator.start();
 */

const { shouldSnooze, getSnoozeReason } = require('../../utils/timeUtils');

class PRProcessingOrchestrator {
  /**
   * @param {Object} useCases - Map of use case instances
   * @param {Object} config - Application configuration
   * @param {Object} eventBus - EventBus instance
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   * @param {number} options.pollInterval - Polling interval in milliseconds
   */
  constructor(useCases, config, eventBus, options = {}) {
    this.useCases = useCases;
    this.config = config;
    this.eventBus = eventBus;
    this.logger = options.logger || console;
    this.pollInterval = options.pollInterval || (config.checkIntervalMinutes || 7) * 60 * 1000;

    this.isRunning = false;
    this.pollTimer = null;
    this.isShuttingDown = false;

    // Statistics
    this.stats = {
      totalProcessed: 0,
      totalNotified: 0,
      totalErrors: 0,
      lastPollTime: null,
      startTime: null
    };
  }

  /**
   * Start the orchestrator
   *
   * @returns {Promise<void>}
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn('[PRProcessingOrchestrator] Already running');
      return;
    }

    this.isRunning = true;
    this.stats.startTime = new Date();

    this.logger.info(
      `[PRProcessingOrchestrator] Starting (poll interval: ${this.pollInterval}ms)`
    );

    // Initial poll
    await this._poll();

    // Start periodic polling
    this.pollTimer = setInterval(() => {
      this._poll().catch(error => {
        this.logger.error('[PRProcessingOrchestrator] Poll error:', error);
      });
    }, this.pollInterval);

    // Emit started event
    await this.eventBus.emitAsync('orchestrator.started', {
      startTime: this.stats.startTime,
      pollInterval: this.pollInterval
    });
  }

  /**
   * Stop the orchestrator gracefully
   *
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    this.isShuttingDown = true;
    this.logger.info('[PRProcessingOrchestrator] Shutting down...');

    // Clear poll timer
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    // Wait for current poll to complete (if any)
    while (this._isPolling) {
      this.logger.debug('[PRProcessingOrchestrator] Waiting for poll to complete...');
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.isRunning = false;
    this.isShuttingDown = false;

    // Log final statistics
    const uptime = Date.now() - this.stats.startTime.getTime();
    this.logger.info(
      `[PRProcessingOrchestrator] Stopped (uptime: ${Math.floor(uptime / 1000)}s, ` +
      `processed: ${this.stats.totalProcessed}, notified: ${this.stats.totalNotified}, ` +
      `errors: ${this.stats.totalErrors})`
    );

    // Emit stopped event
    await this.eventBus.emitAsync('orchestrator.stopped', {
      uptime,
      stats: this.stats
    });
  }

  /**
   * Poll for PRs and process them
   * @private
   */
  async _poll() {
    if (this._isPolling || this.isShuttingDown) {
      return;
    }

    this._isPolling = true;
    const pollStartTime = Date.now();

    try {
      this.logger.debug('[PRProcessingOrchestrator] Starting poll cycle');
      this.stats.lastPollTime = new Date();

      // Process all instances
      const instances = this.config.instances || {};
      const results = [];

      for (const instance of Object.values(instances)) {
        try {
          const instanceResult = await this._processInstance(instance);
          results.push(...instanceResult);
        } catch (error) {
          this.logger.error(
            `[PRProcessingOrchestrator] Error processing instance ${instance.key}:`,
            error
          );
          this.stats.totalErrors++;
        }
      }

      const pollDuration = Date.now() - pollStartTime;
      this.logger.debug(
        `[PRProcessingOrchestrator] Poll cycle completed ` +
        `(${results.length} PRs processed, ${pollDuration}ms)`
      );

      // Emit poll completed event
      await this.eventBus.emitAsync('orchestrator.poll_completed', {
        duration: pollDuration,
        results,
        stats: this.stats
      });

    } catch (error) {
      this.logger.error('[PRProcessingOrchestrator] Poll cycle error:', error);
      this.stats.totalErrors++;

      await this.eventBus.emitAsync('error.occurred', {
        useCase: 'PRProcessingOrchestrator',
        error: error.message
      });

    } finally {
      this._isPolling = false;
    }
  }

  /**
   * Process a single instance
   * @private
   */
  async _processInstance(instance) {
    const results = [];
    const repos = Object.entries(instance.repos || {});

    this.logger.debug(`[PRProcessingOrchestrator] Processing instance ${instance.key}`);

    const githubAdapter = this.useCases.githubService.create(instance.key);

    for (const [repoName, repoConfig] of repos) {
      try {
        const repo = {
          name: repoName,
          threadId: repoConfig.thread_id,
          instanceKey: instance.key,
          config: repoConfig
        };

        const repoResults = await this._processRepository(instance, repo, githubAdapter);
        results.push(...repoResults);

      } catch (error) {
        this.logger.error(
          `[PRProcessingOrchestrator] Error processing repo ${repoName}:`,
          error
        );
      }
    }

    return results;
  }

  /**
   * Process a single repository
   * @private
   */
  async _processRepository(instance, repo, githubAdapter) {
    const results = [];

    try {
      // Fetch open PRs from GitHub
      const openPRs = await githubAdapter.getOpenPRs(repo.name);

      this.logger.debug(
        `[PRProcessingOrchestrator] Found ${openPRs.length} open PRs in ${repo.name}`
      );

      // Process each PR
      for (const pr of openPRs) {
        try {
          // Check if PR should be processed
          const shouldProcess = await this.useCases.processPR.shouldProcess(
            instance,
            repo,
            pr,
            instance
          );

          if (!shouldProcess.shouldProcess) {
            this.logger.debug(
              `[PRProcessingOrchestrator] PR #${pr.number} skipped: ${shouldProcess.reason}`
            );
            continue;
          }

          // Get PR details
          const prDetails = await githubAdapter.getPRDetails(
            repo.name,
            pr.number
          );

          // Process the PR
          const result = await this.useCases.processPR.execute(
            instance,
            repo,
            pr,
            prDetails
          );

          results.push(result);

          if (result.status === 'processed') {
            this.stats.totalProcessed++;
            if (result.notificationSent) {
              this.stats.totalNotified++;
            }
          }

        } catch (error) {
          this.logger.error(
            `[PRProcessingOrchestrator] Error processing PR #${pr.number}:`,
            error
          );
          this.stats.totalErrors++;

          results.push({
            prNumber: pr.number,
            status: 'error',
            error: error.message
          });
        }
      }

      // Check for outdated reviews (with snooze support, matching feature branch)
      // Feature branch: schedulerDaemon.js L261-266
      const snoozeConfig = this.config.snoozeTime || null;
      if (shouldSnooze(snoozeConfig)) {
        const snoozeReason = getSnoozeReason(snoozeConfig);
        this.logger.info(
          `[PRProcessingOrchestrator] ${snoozeReason}. Skipping outdated review check for ${repo.name}.`
        );
      } else {
        try {
          await this.useCases.checkOutdatedReviews.execute(instance, repo, openPRs, githubAdapter);
        } catch (error) {
          this.logger.error(
            `[PRProcessingOrchestrator] Error checking outdated reviews in ${repo.name}:`,
            error
          );
        }
      }

    } catch (error) {
      this.logger.error(
        `[PRProcessingOrchestrator] Error processing repository ${repo.name}:`,
        error
      );
      throw error;
    }

    return results;
  }

  /**
   * Get current statistics
   *
   * @returns {Object} Current statistics
   */
  getStats() {
    return {
      ...this.stats,
      uptime: this.stats.startTime ? Date.now() - this.stats.startTime.getTime() : 0,
      isRunning: this.isRunning,
      isPolling: this._isPolling
    };
  }

}

module.exports = PRProcessingOrchestrator;
