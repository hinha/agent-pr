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

const { shouldSnooze, getSnoozeReason, getCurrentTimestampWIB } = require('../../utils/timeUtils');

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

    // Outdated review check interval (separate from PR poll interval)
    this.outdatedReviewCheckInterval = config.app?.outdatedReviewCheckIntervalMs || 0;
    this.lastOutdatedReviewCheckTimeByRepo = new Map(); // key: `${instance.key}/${repo.name}`

    this.logger.info(
      `[PRProcessingOrchestrator] Configured intervals - ` +
      `PR poll: ${this.pollInterval}ms (${Math.round(this.pollInterval / 60000)}min), ` +
      `Outdated review check: ${this.outdatedReviewCheckInterval}ms (${this.outdatedReviewCheckInterval > 0 ? Math.round(this.outdatedReviewCheckInterval / 60000) + 'min' : 'every poll'})`
    );

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
    this.logger.info('[PRProcessingOrchestrator] ===== START() CALLED =====');
    this.logger.info(`[PRProcessingOrchestrator] Current state: isRunning=${this.isRunning}`);

    if (this.isRunning) {
      this.logger.warn('[PRProcessingOrchestrator] Already running, returning');
      return;
    }

    try {
      this.isRunning = true;
      this.stats.startTime = new Date();

      this.logger.info(
        `[PRProcessingOrchestrator] Starting (poll interval: ${this.pollInterval}ms)`
      );

      // Verify dependencies
      this.logger.info('[PRProcessingOrchestrator] Verifying dependencies...');
      this.logger.info(`[PRProcessingOrchestrator] useCases: ${Object.keys(this.useCases || {}).join(', ')}`);
      this.logger.info(`[PRProcessingOrchestrator] config.instances: ${Object.keys(this.config?.instances || {}).join(', ')}`);
      this.logger.info(`[PRProcessingOrchestrator] eventBus: ${!!this.eventBus}`);
      this.logger.info('[PRProcessingOrchestrator] ✓ Dependencies verified');

      // Initial poll
      this.logger.info('[PRProcessingOrchestrator] About to run initial poll...');
      await this._poll();
      this.logger.info('[PRProcessingOrchestrator] ✓ Initial poll completed');

      // Start periodic polling
      this.logger.info('[PRProcessingOrchestrator] Setting up polling interval...');
      this.pollTimer = setInterval(() => {
        this._poll().catch(error => {
          this.logger.error('[PRProcessingOrchestrator] Poll error:', error);
        });
      }, this.pollInterval);

      this.logger.info(`[PRProcessingOrchestrator] ✓ Polling interval set (${this.pollInterval}ms)`);

      // Emit started event
      this.logger.info('[PRProcessingOrchestrator] Emitting orchestrator.started event...');
      await this.eventBus.emitAsync('orchestrator.started', {
        startTime: this.stats.startTime,
        pollInterval: this.pollInterval
      });
      this.logger.info('[PRProcessingOrchestrator] ✓ orchestrator.started event emitted');

      this.logger.info('[PRProcessingOrchestrator] ===== STARTUP COMPLETE =====');
    } catch (error) {
      this.logger.error('[PRProcessingOrchestrator] ===== ERROR DURING START() =====');
      this.logger.error(`[PRProcessingOrchestrator] Error: ${error.message}`);
      this.logger.error(`[PRProcessingOrchestrator] Stack: ${error.stack}`);
      this.logger.error(`[PRProcessingOrchestrator] Error name: ${error.name}`);
      this.logger.error(`[PRProcessingOrchestrator] Error code: ${error.code}`);
      this.isRunning = false;
      throw error;
    }
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
    this.lastOutdatedReviewCheckTimeByRepo.clear();

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
    this.logger.info('[PRProcessingOrchestrator] ===== _poll() CALLED =====');

    if (this._isPolling || this.isShuttingDown) {
      this.logger.info(`[PRProcessingOrchestrator] Skipping poll: _isPolling=${this._isPolling}, isShuttingDown=${this.isShuttingDown}`);
      return;
    }

    this._isPolling = true;
    const pollStartTime = Date.now();

    try {
      this.logger.info('[PRProcessingOrchestrator] Starting poll cycle');
      this.stats.lastPollTime = new Date();

      // Process all instances
      const instances = this.config.instances || {};
      const instanceKeys = Object.keys(instances);
      this.logger.info(`[PRProcessingOrchestrator] Processing ${instanceKeys.length} instance(s): ${instanceKeys.join(', ')}`);

      const results = [];

      for (const instance of Object.values(instances)) {
        try {
          this.logger.info(`[PRProcessingOrchestrator] Processing instance ${instance.key}...`);
          const instanceResult = await this._processInstance(instance);
          this.logger.info(`[PRProcessingOrchestrator] Instance ${instance.key} processing complete: ${instanceResult.length} results`);
          results.push(...instanceResult);
        } catch (error) {
          this.logger.error(
            `[PRProcessingOrchestrator] Error processing instance ${instance.key}:`,
            error
          );
          this.logger.error(`[PRProcessingOrchestrator] Error stack: ${error.stack}`);
          this.stats.totalErrors++;
        }
      }

      const pollDuration = Date.now() - pollStartTime;
      this.logger.info(
        `[PRProcessingOrchestrator] Poll cycle completed ` +
        `(${results.length} PRs processed, ${pollDuration}ms)`
      );

      // Emit poll completed event
      this.logger.info('[PRProcessingOrchestrator] Emitting orchestrator.poll_completed event...');
      await this.eventBus.emitAsync('orchestrator.poll_completed', {
        duration: pollDuration,
        results,
        stats: this.stats
      });
      this.logger.info('[PRProcessingOrchestrator] ✓ orchestrator.poll_completed event emitted');

    } catch (error) {
      this.logger.error('[PRProcessingOrchestrator] ===== POLL CYCLE ERROR =====');
      this.logger.error(`[PRProcessingOrchestrator] Error: ${error.message}`);
      this.logger.error(`[PRProcessingOrchestrator] Stack: ${error.stack}`);
      this.stats.totalErrors++;

      await this.eventBus.emitAsync('error.occurred', {
        useCase: 'PRProcessingOrchestrator',
        error: error.message,
        stack: error.stack
      });

    } finally {
      this._isPolling = false;
      this.logger.info('[PRProcessingOrchestrator] ===== _poll() COMPLETE =====');
    }
  }

  /**
   * Process a single instance
   * @private
   */
  async _processInstance(instance) {
    this.logger.info(`[PRProcessingOrchestrator] ===== _processInstance() CALLED for ${instance.key} =====`);

    const results = [];
    const repos = Object.entries(instance.repos || {});

    this.logger.info(`[PRProcessingOrchestrator] Instance ${instance.key} has ${repos.length} repo(s)`);
    this.logger.info(`[PRProcessingOrchestrator] Repos: ${repos.map(([name]) => name).join(', ')}`);

    try {
      this.logger.info(`[PRProcessingOrchestrator] Creating GitHub adapter for ${instance.key}...`);
      const githubAdapter = this.useCases.githubService.create(instance.key);
      this.logger.info(`[PRProcessingOrchestrator] ✓ GitHub adapter created`);

      for (const [repoName, repoConfig] of repos) {
        try {
          this.logger.info(`[PRProcessingOrchestrator] Processing repo ${repoName}...`);

          const repo = {
            name: repoName,
            threadId: repoConfig.thread_id,
            instanceKey: instance.key,
            config: repoConfig
          };

          this.logger.info(`[PRProcessingOrchestrator] Calling _processRepository for ${repoName}...`);
          const repoResults = await this._processRepository(instance, repo, githubAdapter);
          this.logger.info(`[PRProcessingOrchestrator] ✓ Repo ${repoName} processed: ${repoResults.length} results`);
          results.push(...repoResults);

        } catch (error) {
          this.logger.error(
            `[PRProcessingOrchestrator] Error processing repo ${repoName}:`,
            error
          );
          this.logger.error(`[PRProcessingOrchestrator] Error stack: ${error.stack}`);
        }
      }

      this.logger.info(`[PRProcessingOrchestrator] Instance ${instance.key} processing complete: ${results.length} total results`);
    } catch (error) {
      this.logger.error(`[PRProcessingOrchestrator] ===== ERROR IN _processInstance() for ${instance.key} =====`);
      this.logger.error(`[PRProcessingOrchestrator] Error: ${error.message}`);
      this.logger.error(`[PRProcessingOrchestrator] Stack: ${error.stack}`);
      throw error;
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
            this.logger.info(
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
      } else if (this.outdatedReviewCheckInterval > 0) {
        // Check if enough time has passed since last outdated review check (per-repo)
        const checkKey = `${instance.key}/${repo.name}`;
        const now = getCurrentTimestampWIB().getTime();
        const lastCheck = this.lastOutdatedReviewCheckTimeByRepo.get(checkKey) ?? 0;
        const timeSinceLastCheck = lastCheck ? now - lastCheck : Infinity;

        if (timeSinceLastCheck >= this.outdatedReviewCheckInterval) {
          try {
            this.logger.info(
              `[PRProcessingOrchestrator] Running outdated review check for ${repo.name} ` +
              `(last check: ${lastCheck ? new Date(lastCheck).toISOString() : 'never'}, ` +
              `interval: ${this.outdatedReviewCheckInterval}ms)`
            );
            await this.useCases.checkOutdatedReviews.execute(instance, repo, openPRs, githubAdapter);
            this.lastOutdatedReviewCheckTimeByRepo.set(checkKey, now);
          } catch (error) {
            this.logger.error(
              `[PRProcessingOrchestrator] Error checking outdated reviews in ${repo.name}:`,
              error
            );
          }
        } else {
          this.logger.debug(
            `[PRProcessingOrchestrator] Skipping outdated review check for ${repo.name} ` +
            `(next check in ${Math.ceil((this.outdatedReviewCheckInterval - timeSinceLastCheck) / 1000 / 60)} minutes)`
          );
        }
      } else {
        // No interval configured, run every poll (default behavior)
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
