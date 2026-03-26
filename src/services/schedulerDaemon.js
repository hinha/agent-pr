const config = require('../config');
const logger = require('../utils/logger');
const TimeoutManager = require('../utils/timeoutManager');
const mcpGithubService = require('./mcpGithubService');
const telegramService = require('./telegramService');
const skipManager = require('./skipManager');
const prStateManager = require('./prStateManager');

class SchedulerDaemon {
  constructor() {
    this.checkInterval = null;
    this.activeProcesses = new Map(); // Track ongoing PR processing to avoid duplicates
    this.timeoutManager = new TimeoutManager();
    this.pendingRetries = new Map(); // Track retry timeouts per PR
  }

  /**
   * Process a single new PR with full error isolation
   */
  async processSinglePR(pr) {
    const prIdStr = pr.id.toString();
    this.activeProcesses.set(prIdStr, true);
    logger.info(`Starting processing for PR #${pr.number}`);

    try {
      logger.info(`Fetching PR details for #${pr.number}`);
      // Get PR details via MCP
      const prDetails = await mcpGithubService.getPRDetails(pr.number);
      logger.info(`Preparing to send Telegram notification for PR #${pr.number}`);
      // Generate valid structured summary (sanitized for Telegram markdown)
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
      const currentCount = prStateManager.getNotificationCount(pr.id);
      if (currentCount < 3) {
        await telegramService.sendPRNotification(pr, summary);
        const newCount = await prStateManager.incrementNotificationCount(pr.id);
        logger.info(`✅ Telegram notification sent for PR #${pr.number} (${newCount}/3 times)`);
        // Mark as processed only if 3 notifications have been sent
        if (newCount >= 3) {
          await prStateManager.markProcessed(pr.id);
          logger.info(`Marked PR #${pr.number} as fully processed after 3 notifications`);
        }
      }
    } catch (err) {
      logger.error(`Initial processing failed for PR #${pr.number}: ${err.message}`);
      // Partial failure recovery: retry once after 30s delay
      const retryId = this.timeoutManager.setTimeout(async () => {
        this.pendingRetries.delete(prIdStr);
        if (!await prStateManager.isProcessed(pr.id)) {
          logger.info(`Retrying processing for PR #${pr.number}`);
          try {
            const prDetails = await mcpGithubService.getPRDetails(pr.number);
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
            await telegramService.sendPRNotification(pr, summary);
            await prStateManager.markProcessed(pr.id);
          } catch (retryErr) {
            logger.error(`Permanent failure processing PR #${pr.number}: ${retryErr.message}`);
          }
        }
      }, 30000);
      this.pendingRetries.set(prIdStr, retryId);
    } finally {
      this.activeProcesses.delete(prIdStr);
    }
  }

  /**
   * Main PR check cycle
   */
  async runPRCheckCycle() {
    try {
      // Fetch all open PRs from GitHub via MCP
      const openPRs = await mcpGithubService.getOpenPRs();
      logger.info(`Found ${openPRs.length} total open PRs in repository`);

      // Process all eligible PRs concurrently
      for (const pr of openPRs) {
        // Skip if already processing, processed, or skipped
        if (this.activeProcesses.has(pr.id.toString()) || await prStateManager.isProcessed(pr.id) || skipManager.isSkipped(pr.id)) {
          logger.debug(`Skipping PR #${pr.number}: already in progress/processed/skipped`);
          continue;
        }

        // Skip PRs older than 1 hour
        const prAge = Date.now() - pr.createdAt.getTime();
        if (prAge > config.scheduler.maxAgeMs) {
          logger.debug(`Skipping PR #${pr.number}: older than 1 hour`);
          await prStateManager.markProcessed(pr.id);
          continue;
        }

        // Start processing PR in background
        this.processSinglePR(pr);
      }
    } catch (cycleErr) {
      logger.error(`PR check cycle failed: ${cycleErr.message}`);
    }
  }

  /**
   * Start the scheduler daemon
   */
  start() {
    logger.info('✅ MCP-based PR monitor daemon started');
    // Run first check immediately
    this.runPRCheckCycle();
    // Set recurring check interval
    this.checkInterval = setInterval(() => this.runPRCheckCycle(), config.scheduler.checkIntervalMs);
    // Allow process to exit if this is the only active timer
    if (typeof this.checkInterval.unref === 'function') {
      this.checkInterval.unref();
    }
    logger.info(`Scheduled recurring PR checks every ${config.scheduler.checkIntervalMs / 60000} minutes`);
  }

  /**
   * Gracefully stop the daemon
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    // Clear all pending timeouts
    this.timeoutManager.clearAll();
    this.pendingRetries.clear();
    logger.info('Scheduler daemon stopped');
  }

  /**
   * Wait for all active processes to complete
   * @param {number} timeoutMs - Maximum time to wait in milliseconds (default: 30s)
   * @returns {Promise<boolean>} True if all processes completed, false if timeout
   */
  async waitForCompletion(timeoutMs = 30000) {
    const startTime = Date.now();
    logger.info(`Waiting for ${this.activeProcesses.size} active PR processes to complete...`);

    while (this.activeProcesses.size > 0) {
      if (Date.now() - startTime > timeoutMs) {
        logger.warn(`Timeout waiting for ${this.activeProcesses.size} processes to complete`);
        return false;
      }
      // Check every 100ms
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    logger.info('All active PR processes completed');
    return true;
  }
}

module.exports = new SchedulerDaemon();
