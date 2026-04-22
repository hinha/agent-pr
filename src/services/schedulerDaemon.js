const config = require('../config/yamlConfig');
const logger = require('../utils/logger');
const TimeoutManager = require('../utils/timeoutManager');
const { getMCPService } = require('./mcpGithubService');
const telegramService = require('./telegramService');
const skipManager = require('./skipManager');
const repositoryStateManager = require('./repositoryStateManager');
const reviewStateManager = require('./reviewStateManager');

class SchedulerDaemon {
  constructor() {
    this.checkInterval = null;
    this.outdatedReviewCheckInterval = null;
    this.activeProcesses = new Map();
    this.timeoutManager = new TimeoutManager();
    this.pendingRetries = new Map();
    this.mcpServices = new Map();
  }

  /**
   * Get or create MCP service for an instance
   */
  getMCPService(instanceKey) {
    if (!this.mcpServices.has(instanceKey)) {
      this.mcpServices.set(instanceKey, getMCPService(instanceKey));
    }
    return this.mcpServices.get(instanceKey);
  }

  /**
   * Process a single PR with full error isolation
   */
  async processSinglePR(instance, repoName, repoConfig, pr, mcpService) {
    const prIdStr = pr.id.toString();
    this.activeProcesses.set(prIdStr, true);

    logger.info(`[${instance.owner}/${repoName}] Starting processing for PR #${pr.number}`);

    try {
      const prDetails = await mcpService.getPRDetails(repoName, pr.number);

      const cleanDescription = (pr.description || 'No description').replace(/[*_`#[\]()]/g, '').substring(0, 120);
      const summary = {
        purpose: `${cleanDescription}...`,
        type: pr.title.includes('fix') ? 'bugfix' : pr.title.includes('feat') ? 'feature' : 'other',
        riskLevel: 'low',
        impactArea: 'core',
        diffSize: `${prDetails.totalChanges} changes`,
        suspiciousPatterns: prDetails.files.some(f => f.filename.includes('migration')) ? ['database_migration'] : [],
        recommendedReview: 'safe review'
      };

      const currentCount = repositoryStateManager.getNotificationCount(instance.owner, repoName, pr.id);
      if (currentCount < 3) {
        await telegramService.sendPRNotification(
          instance.owner,
          repoName,
          pr,
          summary,
          repoConfig.thread_id
        );
        const newCount = await repositoryStateManager.incrementNotificationCount(instance.owner, repoName, pr.id);
        logger.info(`[${instance.owner}/${repoName}] Telegram notification sent for PR #${pr.number} (${newCount}/3 times)`);

        if (newCount >= 3) {
          await repositoryStateManager.markProcessed(instance.owner, repoName, pr.id);
          logger.info(`[${instance.owner}/${repoName}] Marked PR #${pr.number} as fully processed`);
        }
      }
    } catch (err) {
      logger.error(`[${instance.owner}/${repoName}] Initial processing failed for PR #${pr.number}: ${err.message}`);

      if (err.message && err.message.includes('cannot be reviewed: contains unsupported file types')) {
        logger.warn(`[${instance.owner}/${repoName}] Permanently skipping PR #${pr.number} due to unsupported file types`);
        await repositoryStateManager.markProcessed(instance.owner, repoName, pr.id);
        this.activeProcesses.delete(prIdStr);
        return;
      }

      const retryId = this.timeoutManager.setTimeout(async () => {
        this.pendingRetries.delete(prIdStr);
        if (!await repositoryStateManager.isProcessed(instance.owner, repoName, pr.id)) {
          logger.info(`[${instance.owner}/${repoName}] Retrying processing for PR #${pr.number}`);
          try {
            const prDetails = await mcpService.getPRDetails(repoName, pr.number);
            const cleanDescription = (pr.description || 'No description').replace(/[*_`#[\]()]/g, '').substring(0, 120);
            const summary = {
              purpose: `${cleanDescription}...`,
              type: pr.title.includes('fix') ? 'bugfix' : pr.title.includes('feat') ? 'feature' : 'other',
              riskLevel: 'low',
              impactArea: 'core',
              diffSize: `${prDetails.totalChanges} changes`,
              suspiciousPatterns: prDetails.files.some(f => f.filename.includes('migration')) ? ['database_migration'] : [],
              recommendedReview: 'safe review'
            };
            await telegramService.sendPRNotification(
              instance.owner,
              repoName,
              pr,
              summary,
              repoConfig.thread_id
            );
            await repositoryStateManager.markProcessed(instance.owner, repoName, pr.id);
          } catch (retryErr) {
            logger.error(`[${instance.owner}/${repoName}] Permanent failure for PR #${pr.number}: ${retryErr.message}`);

            if (retryErr.message && retryErr.message.includes('cannot be reviewed: contains unsupported file types')) {
              logger.warn(`[${instance.owner}/${repoName}] Permanently skipping PR #${pr.number} due to unsupported file types`);
              await repositoryStateManager.markProcessed(instance.owner, repoName, pr.id);
            }
          }
        }
      }, 30000);
      this.pendingRetries.set(prIdStr, retryId);
    } finally {
      this.activeProcesses.delete(prIdStr);
    }
  }

  /**
   * Process all PRs for a specific repository
   */
  async processRepository(instanceKey, instance, repoName, repoConfig) {
    const mcpService = this.getMCPService(instanceKey);

    try {
      const openPRs = await mcpService.getOpenPRs(repoName);
      logger.info(`[${instanceKey}/${repoName}] Found ${openPRs.length} open PRs`);

      for (const pr of openPRs) {
        if (this.activeProcesses.has(pr.id.toString())) {
          logger.debug(`[${instanceKey}/${repoName}] Skipping PR #${pr.number}: already processing`);
          continue;
        }

        if (await repositoryStateManager.isProcessed(instance.owner, repoName, pr.id)) {
          logger.debug(`[${instanceKey}/${repoName}] Skipping PR #${pr.number}: already processed`);
          continue;
        }

        const repoKey = skipManager.getRepoKey(instance.owner, repoName);
        if (skipManager.isSkipped(instance.owner, repoName, pr.id)) {
          logger.debug(`[${instanceKey}/${repoName}] Skipping PR #${pr.number}: skipped`);
          continue;
        }

        const prAge = Date.now() - pr.createdAt.getTime();
        if (prAge > instance.maxAgeMs) {
          logger.debug(`[${instanceKey}/${repoName}] Skipping PR #${pr.number}: older than ${instance.maxAgeMs / 3600000}h`);
          await repositoryStateManager.markProcessed(instance.owner, repoName, pr.id);
          continue;
        }

        this.processSinglePR(instance, repoName, repoConfig, pr, mcpService);
      }
    } catch (err) {
      logger.error(`[${instanceKey}/${repoName}] Repository processing failed: ${err.message}`);
    }
  }

  /**
   * Main PR check cycle - iterate through all instances and repos
   */
  async runPRCheckCycle() {
    try {
      const instanceCount = Object.keys(config.instances).length;
      logger.info(`Starting PR check cycle for ${instanceCount} instance(s)`);

      for (const [instanceKey, instance] of Object.entries(config.instances)) {
        const repoCount = Object.keys(instance.repos || {}).length;
        logger.info(`[${instanceKey}] Processing ${repoCount} repository(ies)`);

        for (const [repoName, repoConfig] of Object.entries(instance.repos || {})) {
          await this.processRepository(instanceKey, instance, repoName, repoConfig);
        }
      }

      const stats = repositoryStateManager.getStats();
      logger.info(`PR check cycle completed. Stats: ${stats.totalRepos} repos, ${stats.totalProcessedPRs} processed PRs, ${stats.totalNotifications} notifications`);
    } catch (cycleErr) {
      logger.error(`PR check cycle failed: ${cycleErr.message}`);
    }
  }

  /**
   * Check for outdated reviews in a repository
   */
  async checkOutdatedReviews(instance, repoName, repoConfig, mcpService) {
    try {
      // Skip if review tools are not available
      if (await mcpService.checkReviewToolsAvailable() === false) {
        logger.debug(`[${instance.owner}/${repoName}] Skipping outdated review check - tools not available`);
        return;
      }

      const openPRs = await mcpService.getOpenPRs(repoName);

      for (const pr of openPRs) {
        try {
          const reviews = await mcpService.getPRReviews(repoName, pr.number);

          const reviewState = await reviewStateManager.updateReviewState(
            instance.owner,
            repoName,
            pr.id,
            reviews,
            pr.headSha
          );

          if (!reviewState) continue;

          const hasNewCommits = reviewStateManager.hasNewCommits(
            instance.owner,
            repoName,
            pr.id,
            pr.headSha
          );

          // Check if there are new comments after the review
          const comments = await mcpService.getPRComments(repoName, pr.number);
          const reviewDate = new Date(reviewState.submitted_at);
          const hasNewComments = comments.some(c => new Date(c.created_at) > reviewDate);

          if (hasNewComments) {
            logger.info(`[${instance.owner}/${repoName}] PR #${pr.number} has new comments after review, skipping outdated notification`);
            await reviewStateManager.clearReviewState(instance.owner, repoName, pr.id);
            continue;
          }

          if (reviewState.has_outdated && hasNewCommits && !reviewState.dismissed) {
            await telegramService.sendOutdatedReviewNotification(
              instance.owner,
              repoName,
              pr,
              reviewState,
              repoConfig.thread_id
            );
          }
        } catch (err) {
          logger.error(`[${instance.owner}/${repoName}] Error checking PR #${pr.number} for outdated reviews: ${err.message}`);
        }
      }
    } catch (err) {
      logger.error(`[${instance.owner}/${repoName}] Outdated review check failed: ${err.message}`);
    }
  }

  /**
   * Run outdated review check cycle
   */
  async runOutdatedReviewCheckCycle() {
    try {
      logger.info('Starting outdated review check cycle');

      let toolsAvailableForAny = false;

      for (const [instanceKey, instance] of Object.entries(config.instances)) {
        const repoCount = Object.keys(instance.repos || {}).length;
        logger.info(`[${instanceKey}] Checking ${repoCount} repository(ies) for outdated reviews`);

        const mcpService = this.getMCPService(instanceKey);

        // Check if tools are available for this instance
        const toolsAvailable = await mcpService.checkReviewToolsAvailable();
        if (toolsAvailable) {
          toolsAvailableForAny = true;
        }

        for (const [repoName, repoConfig] of Object.entries(instance.repos || {})) {
          await this.checkOutdatedReviews(instance, repoName, repoConfig, mcpService);
        }
      }

      if (!toolsAvailableForAny) {
        logger.warn('Outdated review check feature is not available for any instances - MCP servers may not support the required tools');
      }

      const stats = reviewStateManager.getStats();
      logger.info(`Outdated review check cycle completed. Stats: ${stats.totalRepos} repos, ${stats.totalReviews} tracked reviews, ${stats.totalOutdated} outdated, ${stats.totalDismissed} dismissed`);
    } catch (cycleErr) {
      logger.error(`Outdated review check cycle failed: ${cycleErr.message}`);
    }
  }

  /**
   * Start the scheduler daemon
   */
  start() {
    const instanceCount = Object.keys(config.instances).length;
    let totalRepos = 0;
    for (const instance of Object.values(config.instances)) {
      totalRepos += Object.keys(instance.repos || {}).length;
    }

    logger.info(`✅ Multi-instance PR monitor daemon started`);
    logger.info(`📊 Monitoring ${instanceCount} instance(s), ${totalRepos} repository(ies)`);

    this.runPRCheckCycle();
    this.checkInterval = setInterval(() => this.runPRCheckCycle(), config.app.checkIntervalMs);

    if (typeof this.checkInterval.unref === 'function') {
      this.checkInterval.unref();
    }

    logger.info(`⏰ Scheduled recurring PR checks every ${config.app.checkIntervalMs / 60000} minutes`);

    if (config.app.outdatedReviewCheckIntervalMs > 0) {
      this.runOutdatedReviewCheckCycle();
      this.outdatedReviewCheckInterval = setInterval(() => this.runOutdatedReviewCheckCycle(), config.app.outdatedReviewCheckIntervalMs);

      if (typeof this.outdatedReviewCheckInterval.unref === 'function') {
        this.outdatedReviewCheckInterval.unref();
      }

      logger.info(`⏰ Scheduled outdated review checks every ${config.app.outdatedReviewCheckIntervalMs / 60000} minutes`);
    }
  }

  /**
   * Gracefully stop the daemon
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    if (this.outdatedReviewCheckInterval) {
      clearInterval(this.outdatedReviewCheckInterval);
      this.outdatedReviewCheckInterval = null;
    }

    this.timeoutManager.clearAll();
    this.pendingRetries.clear();

    for (const [instanceKey, mcpService] of this.mcpServices.entries()) {
      try {
        mcpService.cleanup();
      } catch (err) {
        logger.error(`Failed to cleanup MCP service for ${instanceKey}: ${err.message}`);
      }
    }
    this.mcpServices.clear();

    logger.info('Scheduler daemon stopped');
  }

  /**
   * Wait for all active processes to complete
   */
  async waitForCompletion(timeoutMs = 30000) {
    const startTime = Date.now();
    logger.info(`Waiting for ${this.activeProcesses.size} active PR processes to complete...`);

    while (this.activeProcesses.size > 0) {
      if (Date.now() - startTime > timeoutMs) {
        logger.warn(`Timeout waiting for ${this.activeProcesses.size} processes to complete`);
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.info('All active PR processes completed');
    return true;
  }
}

module.exports = new SchedulerDaemon();
