const TelegramBot = require('node-telegram-bot-api');
const config = require('../config/yamlConfig');
const logger = require('../utils/logger');
const TimeoutManager = require('../utils/timeoutManager');
const skipManager = require('./skipManager');
const repositoryStateManager = require('./repositoryStateManager');
const reviewStateManager = require('./reviewStateManager');
const { getMCPService } = require('./mcpGithubService');

class TelegramService {
  constructor() {
    this.bot = new TelegramBot(config.app.telegram.botToken, { polling: true });
    this.chatId = config.app.telegram.chatId;
    this.timeoutManager = new TimeoutManager();
    this.pollingRestartTimeout = null;

    // Build compact instance/repo mapping for callback data
    this.instanceMap = new Map();
    this.repoMap = new Map();
    this.buildMapping();

    this.pollingErrorHandler = this.handlePollingError.bind(this);
    this.callbackQueryHandler = this.handleCallbackQuery.bind(this);

    this.setupPollingErrorHandler();
    this.setupButtonHandlers();
    this.setupGracefulShutdown();
    this.cleanWebhook();
    logger.info('Telegram bot initialized with active polling');
  }

  /**
   * Build mapping for compact callback data format
   * Format: instanceIdx:repoIdx instead of owner:repo
   */
  buildMapping() {
    let instanceIdx = 0;
    for (const [instanceKey, instance] of Object.entries(config.instances)) {
      this.instanceMap.set(instanceIdx, { instanceKey, instance });

      let repoIdx = 0;
      for (const repoName of Object.keys(instance.repos || {})) {
        this.repoMap.set(`${instanceIdx}:${repoIdx}`, { owner: instance.owner, repo: repoName, instanceKey, instance });
        repoIdx++;
      }

      instanceIdx++;
    }
    logger.info(`Built mapping for ${this.instanceMap.size} instances, ${this.repoMap.size} repos`);
  }

  /**
   * Get repo info from compact indices
   */
  getRepoInfo(instanceIdx, repoIdx) {
    return this.repoMap.get(`${instanceIdx}:${repoIdx}`);
  }

  /**
   * Get instance and repo indices for a given owner/repo
   */
  getRepoIndices(owner, repo) {
    for (const [key, value] of this.repoMap.entries()) {
      if (value.owner === owner && value.repo === repo) {
        const [instanceIdx, repoIdx] = key.split(':').map(Number);
        return { instanceIdx, repoIdx };
      }
    }
    return null;
  }

  /**
   * Clean webhook to ensure polling mode
   */
  async cleanWebhook() {
    try {
      if (typeof this.bot.deleteWebhook === 'function') {
        await this.bot.deleteWebhook({ drop_pending_updates: false });
        logger.info('Webhook deleted, ensuring polling mode');
      } else {
        logger.debug('deleteWebhook not available, skipping webhook cleanup');
      }
    } catch (err) {
      logger.warn(`Failed to delete webhook: ${err.message}`);
    }
  }

  /**
   * Handle polling errors
   */
  setupPollingErrorHandler() {
    this.bot.on('polling_error', this.pollingErrorHandler);
  }

  handlePollingError(error) {
    logger.error(`Polling error: ${error.code} - ${error.message}`);

    if (error.code === 'ETELEGRAM' && error.message.includes('409')) {
      logger.warn('Detected multiple polling instances. Backing off...');
      if (this.pollingRestartTimeout) {
        this.timeoutManager.clearTimeout(this.pollingRestartTimeout);
      }
      this.bot.stopPolling();
      this.pollingRestartTimeout = this.timeoutManager.setTimeout(() => {
        this.bot.startPolling();
        logger.info('Polling restarted after 409 conflict');
        this.pollingRestartTimeout = null;
      }, 5000);
    }

    if (error.code === 'EFATAL') {
      logger.error('Fatal polling error detected');
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupGracefulShutdown() {
    logger.debug('Graceful shutdown handlers managed centrally');
  }

  /**
   * Custom exponential backoff retry logic
   */
  async retryOperation(operation, retries, minTimeout, factor) {
    let attempt = 0;
    while (attempt < retries) {
      try {
        return await operation();
      } catch (err) {
        attempt++;
        if (attempt >= retries) throw err;
        const delay = minTimeout * Math.pow(factor, attempt - 1);
        logger.warn(`Telegram attempt ${attempt} failed: ${err.message}, retrying in ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Setup inline button click event handlers
   */
  setupButtonHandlers() {
    this.bot.on('callback_query', this.callbackQueryHandler);
  }

  /**
   * Handle callback query with new format: action:owner:repo:prId
   */
  async handleCallbackQuery(query) {
    const dataParts = query.data.split(':');

    let action, instanceIdx, repoIdx, prId, level, reviewId;
    let owner, repo, repoConfig, mcpService, instance;

    if (dataParts.length === 4) {
      // Standard action: action:instanceIdx:repoIdx:prId
      [action, instanceIdx, repoIdx, prId] = dataParts;
    } else if (dataParts.length === 5) {
      // Could be: review_level:instanceIdx:repoIdx:prId:level
      // Or: approve_outdated:instanceIdx:repoIdx:prId:reviewId
      // Or: re_review:instanceIdx:repoIdx:prId:reviewId
      // Or: dismiss_outdated:instanceIdx:repoIdx:prId:reviewId
      const firstPart = dataParts[0];
      if (firstPart === 'review_level') {
        [action, instanceIdx, repoIdx, prId, level] = dataParts;
      } else {
        [action, instanceIdx, repoIdx, prId, reviewId] = dataParts;
      }
    } else if (dataParts.length === 6) {
      // review_level_outdated:instanceIdx:repoIdx:prId:reviewId:level
      [action, instanceIdx, repoIdx, prId, reviewId, level] = dataParts;
    } else {
      await this.bot.answerCallbackQuery(query.id, { text: '❌ Invalid callback data format' });
      return;
    }

    const prIdNum = parseInt(prId);

    try {
      const repoInfo = this.getRepoInfo(parseInt(instanceIdx), parseInt(repoIdx));
      if (!repoInfo) {
        await this.bot.answerCallbackQuery(query.id, { text: '❌ Repository not found' });
        return;
      }

      ({ owner, repo, instance } = repoInfo);
      repoConfig = config.getRepoConfig(owner, repo);
      mcpService = getMCPService(instance.key);
      const openPRs = await mcpService.getOpenPRs(repo);
      const pr = openPRs.find(p => p.id === prIdNum);

      if (!pr) {
        await this.bot.answerCallbackQuery(query.id, { text: `❌ PR not found` });
        return;
      }

      if (action === 'review_now') {
        await this.bot.answerCallbackQuery(query.id);
        const prDetails = await mcpService.getPRDetails(repo, pr.number);
        await this.bot.sendMessage(this.chatId,
          `🔍 <b>Pilih Level Review untuk ${this.escapeHtml(`${owner}/${repo}`)} PR #${pr.number}</b>\n\n` +
          `📁 Files changed: ${this.escapeHtml(String(prDetails?.filesChanged || 'N/A'))}\n` +
          `📊 Total changes: ${this.escapeHtml(String(prDetails?.totalChanges || 'N/A'))}`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🟢 Low (Basic)', callback_data: `review_level:${instanceIdx}:${repoIdx}:${pr.id}:low` },
                  { text: '🟡 Medium (Standard)', callback_data: `review_level:${instanceIdx}:${repoIdx}:${pr.id}:medium` }
                ],
                [
                  { text: '🔴 High (Comprehensive)', callback_data: `review_level:${instanceIdx}:${repoIdx}:${pr.id}:high` }
                ],
                [
                  { text: '❌ Batal', callback_data: `review_cancel:${instanceIdx}:${repoIdx}:${pr.id}` }
                ]
              ]
            },
            message_thread_id: repoConfig.threadId,
            parse_mode: 'HTML'
          }
        );
      } else if (action === 'visit') {
        await this.bot.answerCallbackQuery(query.id, { text: '🔗 Membuka halaman PR...' });
        await this.bot.sendMessage(this.chatId, `🔗 PR URL: ${pr.url}`, {
          disable_web_page_preview: false,
          message_thread_id: repoConfig.threadId
        });
      } else if (action === 'approve') {
        await this.bot.answerCallbackQuery(query.id, { text: '✅ Approving PR...' });
        await mcpService.approvePR(repo, pr.number);
        await repositoryStateManager.markProcessed(owner, repo, pr.id);
        await this.bot.editMessageText(`✅ ${owner}/${repo} PR #${pr.number} has been approved!`, {
          chat_id: this.chatId,
          message_id: query.message.message_id,
          message_thread_id: repoConfig.threadId
        });
        logger.info(`[${owner}/${repo}] PR #${pr.number} approved`);
      } else if (action === 'reject') {
        await this.bot.answerCallbackQuery(query.id, { text: '❌ Rejecting PR...' });
        try {
          await mcpService.requestChanges(repo, pr.number, 'Changes requested via OpenClaw PR Monitor');
          await this.bot.editMessageText(`❌ ${owner}/${repo} PR #${pr.number} changes requested.`, {
            chat_id: this.chatId,
            message_id: query.message.message_id,
            message_thread_id: repoConfig.threadId
          });
        } catch (error) {
          if (error.message.includes('Can not request changes on your own pull request')) {
            logger.warn(`[${owner}/${repo}] Cannot request changes on own PR`);
            await mcpService.callMCP('pull_request_review_write', {
              owner: owner,
              repo: repo,
              pull_number: pr.number,
              event: 'COMMENT',
              body: '⚠️ Cannot request changes on your own PR (GitHub restriction).\n\nChanges requested via OpenClaw PR Monitor.'
            });
            await this.bot.editMessageText(`⚠️ ${owner}/${repo} PR #${pr.number} - Changes requested as COMMENT.`, {
              chat_id: this.chatId,
              message_id: query.message.message_id,
              message_thread_id: repoConfig.threadId
            });
          } else {
            throw error;
          }
        }
      } else if (action === 'close') {
        await this.bot.answerCallbackQuery(query.id, { text: '🔒 Closing PR...' });
        await mcpService.closePR(repo, pr.number);
        await this.bot.editMessageText(`🔒 ${owner}/${repo} PR #${pr.number} has been closed.`, {
          chat_id: this.chatId,
          message_id: query.message.message_id,
          message_thread_id: repoConfig.threadId
        });
      } else if (action === 'skip') {
        await skipManager.addSkip(owner, repo, prIdNum);
        await this.bot.answerCallbackQuery(query.id, { text: '⏸️ PR notifications suppressed' });
        await this.bot.editMessageText(`[${owner}/${repo}] PR #${prIdNum} notifications skipped.`, {
          chat_id: this.chatId,
          message_id: query.message.message_id,
          message_thread_id: repoConfig.threadId
        });
      } else if (action === 'review_level') {
        await this.bot.answerCallbackQuery(query.id, { text: `🚀 Starting ${level} review...` });

        const instance = repoConfig.instance;
        await this.bot.sendMessage(this.chatId,
          `🔄 <b>Reviewing ${this.escapeHtml(`${owner}/${repo}`)} PR #${prId} at ${this.escapeHtml(level.toUpperCase())} level</b>\n` +
          `⏳ This may take ${this.escapeHtml(instance.agent.reviewTimeoutMessage)}...`,
          {
            message_thread_id: repoConfig.threadId,
            parse_mode: 'HTML'
          }
        );

        const openclawAgentService = require('./openclawAgentService');
        const reviewResult = await openclawAgentService.runReviewWithLevel(owner, repo, pr, level);

        const ghResult = await mcpService.createReviewWithComments(repo, pr, reviewResult);

        try {
          const reviewUrl = ghResult?.html_url || pr.url;
          await this.bot.sendMessage(this.chatId,
            `✅ <b>Review Complete!</b>\n\n` +
            `📁 <b>Repo:</b> ${this.escapeHtml(`${owner}/${repo}`)}\n` +
            `📝 <b>Level:</b> ${this.escapeHtml(level.toUpperCase())}\n` +
            `💬 <b>Comments:</b> ${reviewResult.comments.length}\n` +
            `🔗 ${this.escapeHtml(reviewUrl)}`,
            { message_thread_id: repoConfig.threadId, parse_mode: 'HTML' }
          );
        } catch (msgErr) {
          logger.error(`Failed to send confirmation: ${msgErr.message}`);
        }
      } else if (action === 'review_cancel') {
        await this.bot.answerCallbackQuery(query.id, { text: '❌ Review cancelled' });
        await this.bot.deleteMessage(this.chatId, query.message.message_id);
      } else if (action === 'approve_outdated') {
        await this.handleApproveOutdated(query, instanceIdx, repoIdx, prId, reviewId, owner, repo, repoConfig, pr);
      } else if (action === 're_review') {
        await this.handleReReview(query, instanceIdx, repoIdx, prId, reviewId, owner, repo, repoConfig, pr);
      } else if (action === 'dismiss_outdated') {
        await this.handleDismissOutdated(query, instanceIdx, repoIdx, prId, reviewId, owner, repo, repoConfig);
      } else if (action === 'review_level_outdated') {
        await this.handleReviewLevelOutdated(query, instanceIdx, repoIdx, prId, reviewId, level, owner, repo, repoConfig, pr);
      }
    } catch (err) {
      logger.error(`Button handler error: ${err.message}`, { action, owner, repo, prId });
      try {
        await this.bot.answerCallbackQuery(query.id, { text: '❌ Action failed' });
      } catch (answerErr) {
        logger.error(`Failed to answer callback query: ${answerErr.message}`);
      }
    }
  }

  /**
   * Handle approve after outdated review
   */
  async handleApproveOutdated(query, instanceIdx, repoIdx, prId, reviewId, owner, repo, repoConfig, pr) {
    try {
      const mcpService = getMCPService(repoConfig.instance.key);

      await mcpService.approvePR(repo, pr.number);

      await this.bot.editMessageText(`✅ ${owner}/${repo} PR #${pr.number} has been approved!`, {
        chat_id: this.chatId,
        message_id: query.message.message_id,
        message_thread_id: repoConfig.threadId
      });

      await reviewStateManager.clearReviewState(owner, repo, pr.id);
      await this.bot.answerCallbackQuery(query.id);

      logger.info(`[${owner}/${repo}] PR #${pr.number} approved (outdated review ${reviewId})`);
    } catch (err) {
      logger.error(`[${owner}/${repo}] Failed to approve PR #${pr.number}: ${err.message}`);
      await this.bot.answerCallbackQuery(query.id, { text: `❌ Error: ${err.message}`, show_alert: true });
    }
  }

  /**
   * Handle re-review request
   */
  async handleReReview(query, instanceIdx, repoIdx, prId, reviewId, owner, repo, repoConfig, pr) {
    try {
      await this.bot.answerCallbackQuery(query.id);

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🟢 Low', callback_data: `review_level_outdated:${instanceIdx}:${repoIdx}:${prId}:${reviewId}:low` },
            { text: '🟡 Medium', callback_data: `review_level_outdated:${instanceIdx}:${repoIdx}:${prId}:${reviewId}:medium` }
          ],
          [
            { text: '🔴 High', callback_data: `review_level_outdated:${instanceIdx}:${repoIdx}:${prId}:${reviewId}:high` }
          ],
          [
            { text: '❌ Cancel', callback_data: `review_cancel:${instanceIdx}:${repoIdx}:${prId}` }
          ]
        ]
      };

      await this.bot.editMessageReplyMarkup(keyboard, {
        chat_id: this.chatId,
        message_id: query.message.message_id,
        message_thread_id: repoConfig.threadId
      });
    } catch (err) {
      logger.error(`[${owner}/${repo}] Failed to show re-review options: ${err.message}`);
      await this.bot.answerCallbackQuery(query.id, { text: `❌ Error: ${err.message}`, show_alert: true });
    }
  }

  /**
   * Handle dismiss outdated review
   */
  async handleDismissOutdated(query, instanceIdx, repoIdx, prId, reviewId, owner, repo, repoConfig) {
    try {
      await reviewStateManager.markDismissed(owner, repo, parseInt(prId));

      await this.bot.editMessageText(`✅ Dismissed outdated review notification for ${owner}/${repo} PR #${prId}`, {
        chat_id: this.chatId,
        message_id: query.message.message_id,
        message_thread_id: repoConfig.threadId
      });

      await this.bot.answerCallbackQuery(query.id);

      logger.info(`[${owner}/${repo}] User dismissed outdated review ${reviewId} for PR #${prId}`);
    } catch (err) {
      logger.error(`[${owner}/${repo}] Failed to dismiss outdated review: ${err.message}`);
      await this.bot.answerCallbackQuery(query.id, { text: `❌ Error: ${err.message}`, show_alert: true });
    }
  }

  /**
   * Handle review level selection for outdated PR
   */
  async handleReviewLevelOutdated(query, instanceIdx, repoIdx, prId, reviewId, level, owner, repo, repoConfig, pr) {
    try {
      const mcpService = getMCPService(repoConfig.instance.key);

      await this.bot.answerCallbackQuery(query.id, { text: `🚀 Starting ${level} re-review...` });

      await this.bot.sendMessage(this.chatId,
        `🔄 <b>Re-reviewing ${this.escapeHtml(`${owner}/${repo}`)} PR #${pr.number} at ${this.escapeHtml(level.toUpperCase())} level</b>\n` +
        `⏳ This may take ${this.escapeHtml(repoConfig.instance.agent.reviewTimeoutMessage)}...`,
        {
          message_thread_id: repoConfig.threadId,
          parse_mode: 'HTML'
        }
      );

      const openclawAgentService = require('./openclawAgentService');
      const reviewResult = await openclawAgentService.runReviewWithLevel(owner, repo, pr, level);

      const ghResult = await mcpService.createReviewWithComments(repo, pr, reviewResult);

      try {
        const reviewUrl = ghResult?.html_url || pr.url;
        await this.bot.sendMessage(this.chatId,
          `✅ <b>Re-review Complete!</b>\n\n` +
          `📁 <b>Repo:</b> ${this.escapeHtml(`${owner}/${repo}`)}\n` +
          `📝 <b>Level:</b> ${this.escapeHtml(level.toUpperCase())}\n` +
          `💬 <b>Comments:</b> ${reviewResult.comments.length}\n` +
          `🔗 ${this.escapeHtml(reviewUrl)}`,
          { message_thread_id: repoConfig.threadId, parse_mode: 'HTML' }
        );
      } catch (msgErr) {
        logger.error(`Failed to send confirmation: ${msgErr.message}`);
      }

      await reviewStateManager.clearReviewState(owner, repo, pr.id);
      logger.info(`[${owner}/${repo}] Started ${level} re-review for PR #${pr.number}`);
    } catch (err) {
      logger.error(`[${owner}/${repo}] Failed to start re-review: ${err.message}`);
      await this.bot.answerCallbackQuery(query.id, { text: `❌ Error: ${err.message}`, show_alert: true });
    }
  }

  /**
   * Stop the Telegram service
   */
  async stop() {
    logger.info('Stopping Telegram service...');

    if (this.bot) {
      this.bot.off('polling_error', this.pollingErrorHandler);
      this.bot.off('callback_query', this.callbackQueryHandler);

      try {
        await this.bot.stopPolling();
        logger.info('Telegram polling stopped');
      } catch (error) {
        logger.error(`Error stopping polling: ${error.message}`);
      }
    }

    this.timeoutManager.clearAll();
    this.pollingRestartTimeout = null;

    logger.info('Telegram service stopped');
  }

  /**
   * Helper function to safely escape HTML special characters
   */
  escapeHtml(text) {
    if (text === null || text === undefined) return 'N/A';
    return String(text).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Send PR notification with repo-specific thread routing
   */
  async sendPRNotification(owner, repo, pr, summary, threadId) {
    return this.retryOperation(async () => {
      logger.info(`[${owner}/${repo}] Sending Telegram notification for PR #${pr.number}`);

      const indices = this.getRepoIndices(owner, repo);
      if (!indices) {
        logger.error(`[${owner}/${repo}] Failed to find repo indices for callback data`);
        return;
      }
      const { instanceIdx, repoIdx } = indices;

      const suspiciousPatternsStr = summary.suspiciousPatterns?.length
        ? summary.suspiciousPatterns.join(', ')
        : 'None';

      const message = `🔔 <b>NEW PR DETECTED</b>
<b>${owner}/${repo} PR #${pr.number}: ${this.escapeHtml(pr.title)}</b>
👤 Author: ${this.escapeHtml(pr.author)}
🔗 URL: ${this.escapeHtml(pr.url)}

---
<b>AI PR Summary</b>
📝 Purpose: ${this.escapeHtml(summary.purpose)}
🏷️ Type: ${this.escapeHtml(summary.type)}
⚠️ Risk Level: ${this.escapeHtml(summary.riskLevel)}
🎯 Impact Area: ${this.escapeHtml(summary.impactArea)}
📊 Diff Size: ${this.escapeHtml(summary.diffSize)}
🚨 Suspicious Patterns: ${this.escapeHtml(suspiciousPatternsStr)}
✅ Recommended Review: ${this.escapeHtml(summary.recommendedReview)}`;

      const inlineKeyboard = {
        inline_keyboard: [
          [
            { text: '🔍 Review Now', callback_data: `review_now:${instanceIdx}:${repoIdx}:${pr.id}` },
            { text: '🔗 Visit PR', callback_data: `visit:${instanceIdx}:${repoIdx}:${pr.id}` }
          ],
          [
            { text: '✅ Approve', callback_data: `approve:${instanceIdx}:${repoIdx}:${pr.id}` },
            { text: '❌ Reject', callback_data: `reject:${instanceIdx}:${repoIdx}:${pr.id}` }
          ],
          [
            { text: '🔒 Close PR', callback_data: `close:${instanceIdx}:${repoIdx}:${pr.id}` },
            { text: '⏸️ Skip (3h)', callback_data: `skip:${instanceIdx}:${repoIdx}:${pr.id}` }
          ]
        ]
      };

      await this.bot.sendMessage(this.chatId, message, {
        reply_markup: inlineKeyboard,
        disable_web_page_preview: true,
        message_thread_id: threadId,
        parse_mode: 'HTML'
      });
      logger.info(`[${owner}/${repo}] Notification sent for PR #${pr.number}`);
    }, config.retries.telegramRetries, 3000, config.retries.backoffFactor);
  }

  /**
   * Send warning notification
   */
  async sendWarning(owner, repo, prNumber, message) {
    return this.retryOperation(async () => {
      const repoConfig = config.getRepoConfig(owner, repo);
      const warningMessage = `⚠️ <b>WARNING</b>\n\n${owner}/${repo} PR #${prNumber}: ${this.escapeHtml(message)}`;
      await this.bot.sendMessage(this.chatId, warningMessage, {
        message_thread_id: repoConfig.threadId,
        parse_mode: 'HTML'
      });
      logger.info(`[${owner}/${repo}] Warning sent for PR #${prNumber}`);
    }, config.retries.telegramRetries, 3000, config.retries.backoffFactor);
  }

  /**
   * Send outdated review notification
   */
  async sendOutdatedReviewNotification(owner, repo, pr, reviewState, threadId) {
    return this.retryOperation(async () => {
      const indices = this.getRepoIndices(owner, repo);
      if (!indices) {
        logger.error(`[${owner}/${repo}] Failed to find repo indices for callback data`);
        return;
      }
      const { instanceIdx, repoIdx } = indices;

      const reviewDate = new Date(reviewState.submitted_at).toLocaleString('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short'
      });

      const message = `🔄 <b>OUTDATED REVIEW DETECTED</b>
<b>${owner}/${repo} PR #${pr.number}: ${this.escapeHtml(pr.title)}</b>
👤 Author: ${this.escapeHtml(pr.author)}
🔗 ${this.escapeHtml(pr.url)}

---
📋 <b>Review Status:</b>
• Review requested changes on ${reviewDate}
• Review HEAD: <code>${reviewState.head_sha?.substring(0, 7) || 'N/A'}</code>
• Current HEAD: <code>${pr.headSha?.substring(0, 7) || 'N/A'}</code>
• <b>New commits detected!</b>

This PR has changes that may address previous review comments.`;

      const inlineKeyboard = {
        inline_keyboard: [
          [
            { text: '✅ Approve', callback_data: `approve_outdated:${instanceIdx}:${repoIdx}:${pr.id}:${reviewState.review_id}` },
            { text: '🔍 Re-review', callback_data: `re_review:${instanceIdx}:${repoIdx}:${pr.id}:${reviewState.review_id}` }
          ],
          [
            { text: '🔗 Visit PR', callback_data: `visit:${instanceIdx}:${repoIdx}:${pr.id}` },
            { text: '❌ Dismiss', callback_data: `dismiss_outdated:${instanceIdx}:${repoIdx}:${pr.id}:${reviewState.review_id}` }
          ]
        ]
      };

      await this.bot.sendMessage(this.chatId, message, {
        reply_markup: inlineKeyboard,
        disable_web_page_preview: true,
        message_thread_id: threadId,
        parse_mode: 'HTML'
      });
      logger.info(`[${owner}/${repo}] Outdated review notification sent for PR #${pr.number}`);
    }, config.retries.telegramRetries, 3000, config.retries.backoffFactor);
  }
}

module.exports = new TelegramService();
