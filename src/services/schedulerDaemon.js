const config = require('../config/yamlConfig');
const logger = require('../utils/logger');
const TimeoutManager = require('../utils/timeoutManager');
const timeUtils = require('../utils/timeUtils');
const { getMCPService } = require('./mcpGithubService');
const telegramService = require('./telegramService');
const skipManager = require('./skipManager');
const repositoryStateManager = require('./repositoryStateManager');
const reviewStateManager = require('./reviewStateManager');
const flagsmithSyncService = require('./flagsmithSyncService');
const { analyzePRRisk } = require('../utils/prAnalyzer');

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

      // Analyze PR risk dynamically
      const riskAnalysis = analyzePRRisk(pr, prDetails);

      const cleanDescription = (pr.description || 'No description').replace(/[*_`#[\]()]/g, '').substring(0, 120);
      const summary = {
        purpose: `${cleanDescription}...`,
        type: pr.title.includes('fix') ? 'bugfix' : pr.title.includes('feat') ? 'feature' : 'other',
        riskLevel: riskAnalysis.riskLevel,
        impactArea: riskAnalysis.impactArea,
        diffSize: `${prDetails.totalChanges} changes`,
        suspiciousPatterns: riskAnalysis.suspiciousPatterns,
        recommendedReview: riskAnalysis.recommendedReview,
        filesChanged: prDetails.filesChanged
      };

      logger.info(`[${instance.owner}/${repoName}] PR #${pr.number} analysis: risk=${riskAnalysis.riskLevel}, impact=${riskAnalysis.impactArea}, review=${riskAnalysis.recommendedReview}`);

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

            // Analyze PR risk dynamically in retry as well
            const riskAnalysis = analyzePRRisk(pr, prDetails);

            const cleanDescription = (pr.description || 'No description').replace(/[*_`#[\]()]/g, '').substring(0, 120);
            const summary = {
              purpose: `${cleanDescription}...`,
              type: pr.title.includes('fix') ? 'bugfix' : pr.title.includes('feat') ? 'feature' : 'other',
              riskLevel: riskAnalysis.riskLevel,
              impactArea: riskAnalysis.impactArea,
              diffSize: `${prDetails.totalChanges} changes`,
              suspiciousPatterns: riskAnalysis.suspiciousPatterns,
              recommendedReview: riskAnalysis.recommendedReview,
              filesChanged: prDetails.filesChanged
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
          logger.info(`[${instanceKey}/${repoName}] Skipping PR #${pr.number}: already being processed`);
          continue;
        }

        if (await repositoryStateManager.isProcessed(instance.owner, repoName, pr.id)) {
          logger.info(`[${instanceKey}/${repoName}] Skipping PR #${pr.number}: already marked as processed`);
          continue;
        }

        const repoKey = skipManager.getRepoKey(instance.owner, repoName);
        if (skipManager.isSkipped(instance.owner, repoName, pr.id)) {
          logger.info(`[${instanceKey}/${repoName}] Skipping PR #${pr.number}: user skipped (3h cache active)`);
          continue;
        }

        const prAge = Date.now() - pr.createdAt.getTime();
        if (prAge > instance.maxAgeMs) {
          logger.info(`[${instanceKey}/${repoName}] Skipping PR #${pr.number}: age ${Math.round(prAge / 3600000)}h exceeds max ${instance.maxAgeMs / 3600000}h (created: ${pr.createdAt.toISOString()})`);
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
      const openPRs = await mcpService.getOpenPRs(repoName);
      logger.info(`[${instance.owner}/${repoName}] Checking ${openPRs.length} open PRs for outdated reviews`);

      for (const pr of openPRs) {
        try {
          const reviews = await mcpService.getPRReviews(repoName, pr.number);
          logger.info(`[${instance.owner}/${repoName}] PR #${pr.number}: ${reviews.length} reviews fetched`);

          const reviewState = await reviewStateManager.updateReviewState(
            instance.owner,
            repoName,
            pr.id,
            reviews,
            pr.headSha
          );

          if (!reviewState) {
            logger.info(`[${instance.owner}/${repoName}] PR #${pr.number}: No review state to track`);
            continue;
          }

          logger.info(`[${instance.owner}/${repoName}] PR #${pr.number}: Review state tracked, checking for new commits`);

          const hasNewCommits = reviewStateManager.hasNewCommits(
            instance.owner,
            repoName,
            pr.id,
            pr.headSha
          );

          if (reviewState.has_outdated && hasNewCommits && !reviewState.dismissed) {
            logger.info(`[${instance.owner}/${repoName}] PR #${pr.number}: Sending outdated review notification`);
            await telegramService.sendOutdatedReviewNotification(
              instance.owner,
              repoName,
              pr,
              reviewState,
              repoConfig.thread_id
            );
          } else {
            logger.info(`[${instance.owner}/${repoName}] PR #${pr.number}: has_outdated=${reviewState.has_outdated}, hasNewCommits=${hasNewCommits}, dismissed=${reviewState.dismissed}`);
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
      // Check if we should snooze (time or weekend)
      if (timeUtils.shouldSnooze(config.app.snoozeTime)) {
        const snoozeReason = timeUtils.getSnoozeReason(config.app.snoozeTime);
        logger.info(`${snoozeReason}. Skipping outdated review check.`);
        return;
      }

      logger.info('Starting outdated review check cycle');

      for (const [instanceKey, instance] of Object.entries(config.instances)) {
        const repoCount = Object.keys(instance.repos || {}).length;
        logger.info(`[${instanceKey}] Checking ${repoCount} repository(ies) for outdated reviews`);

        const mcpService = this.getMCPService(instanceKey);

        for (const [repoName, repoConfig] of Object.entries(instance.repos || {})) {
          await this.checkOutdatedReviews(instance, repoName, repoConfig, mcpService);
        }
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
  async start() {
    const instanceCount = Object.keys(config.instances).length;
    let totalRepos = 0;
    for (const instance of Object.values(config.instances)) {
      totalRepos += Object.keys(instance.repos || {}).length;
    }

    logger.info(`✅ Multi-instance PR monitor daemon started`);
    logger.info(`📊 Monitoring ${instanceCount} instance(s), ${totalRepos} repository(ies)`);

    // Initialize Flagsmith sync before starting PR checks
    await flagsmithSyncService.init(config);
    if (config.flagsmith && config.flagsmith.syncIntervalMs) {
      flagsmithSyncService.start(config.flagsmith.syncIntervalMs);
    }

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

    flagsmithSyncService.stop();

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
