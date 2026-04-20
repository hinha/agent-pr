const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const logger = require('../utils/logger');
const TimeoutManager = require('../utils/timeoutManager');
const skipManager = require('./skipManager');
const openclawAgentService = require('./openclawAgentService');

class TelegramService {
  constructor() {
    this.bot = new TelegramBot(config.telegram.botToken, { polling: true });
    this.chatId = config.telegram.chatId;
    this.threadId = config.telegram.threadId;
    this.timeoutManager = new TimeoutManager();
    this.pollingRestartTimeout = null;

    // Store event handler references for cleanup
    this.pollingErrorHandler = this.handlePollingError.bind(this);
    this.callbackQueryHandler = this.handleCallbackQuery.bind(this);

    this.setupPollingErrorHandler();
    this.setupButtonHandlers();
    this.setupGracefulShutdown();
    this.cleanWebhook();
    logger.info('Telegram bot initialized successfully with active polling for button interactions');
  }

  /**
   * Clean webhook to ensure polling mode (not webhook mode)
   */
  async cleanWebhook() {
    try {
      await this.bot.deleteWebhook({ drop_pending_updates: false });
      logger.info('Webhook deleted, ensuring polling mode');
    } catch (err) {
      logger.warn(`Failed to delete webhook: ${err.message}`);
    }
  }

  /**
   * Handle polling errors including 409 Conflict
   */
  setupPollingErrorHandler() {
    this.bot.on('polling_error', this.pollingErrorHandler);
  }

  /**
   * Handle polling errors including 409 Conflict (bound method)
   */
  handlePollingError(error) {
    logger.error(`Polling error: ${error.code} - ${error.message}`);

    // 409 Conflict: Another instance is polling
    if (error.code === 'ETELEGRAM' && error.message.includes('409')) {
      logger.warn('Detected multiple polling instances. This instance will back off and retry.');
      // Clear any existing restart timeout
      if (this.pollingRestartTimeout) {
        this.timeoutManager.clearTimeout(this.pollingRestartTimeout);
      }
      // Stop polling and restart after a delay
      this.bot.stopPolling();
      this.pollingRestartTimeout = this.timeoutManager.setTimeout(() => {
        this.bot.startPolling();
        logger.info('Polling restarted after 409 conflict');
        this.pollingRestartTimeout = null;
      }, 5000);
    }

    // EFATAL: Network error, may need restart
    if (error.code === 'EFATAL') {
      logger.error('Fatal polling error detected, may require manual intervention');
    }
  }

  /**
   * Setup graceful shutdown handlers
   * Note: Shutdown is now handled centrally in index.js
   */
  setupGracefulShutdown() {
    // Shutdown handlers are now managed in index.js
    // This method is kept for backwards compatibility but does nothing
    logger.debug('Graceful shutdown handlers managed centrally in index.js');
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
        logger.warn(`Telegram attempt ${attempt} failed: ${err.message}, retrying in ${delay}ms, retries left: ${retries - attempt}`);
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
   * Handle callback query from inline buttons (bound method)
   */
  async handleCallbackQuery(query) {
      const dataParts = query.data.split(':');
      const action = dataParts[0];
      const prId = dataParts[1];
      const prIdNum = parseInt(prId);

      try {
        // Fetch PR data first for all actions
        const mcpService = require('./mcpGithubService');
        const openPRs = await mcpService.getOpenPRs();
        const pr = openPRs.find(p => p.id === prIdNum);
        if (!pr) throw new Error(`PR #${prId} not found`);

        if (action === 'review_now') {
          await this.bot.answerCallbackQuery(query.id);
          // Fetch PR details for the message
          const mcpService = require('./mcpGithubService');
          const prDetails = await mcpService.getPRDetails(pr.number);
          // Show level selection keyboard
          await this.bot.sendMessage(this.chatId,
            `🔍 <b>Pilih Level Review untuk PR #${pr.number}</b>\n\n` +
            `📁 Files changed: ${prDetails?.filesChanged || 'N/A'}\n` +
            `📊 Total changes: ${prDetails?.totalChanges || 'N/A'}`,
            {
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '🟢 Low (Basic)', callback_data: `review_level:${pr.id}:low` },
                    { text: '🟡 Medium (Standard)', callback_data: `review_level:${pr.id}:medium` }
                  ],
                  [
                    { text: '🔴 High (Comprehensive)', callback_data: `review_level:${pr.id}:high` }
                  ],
                  [
                    { text: '❌ Batal', callback_data: `review_cancel:${pr.id}` }
                  ]
                ]
              },
              message_thread_id: this.threadId,
              parse_mode: 'HTML'
            }
          );
        } else if (action === 'visit') {
          await this.bot.answerCallbackQuery(query.id, { text: '🔗 Membuka halaman PR...' });
          await this.bot.sendMessage(this.chatId, `🔗 PR URL: ${pr.url}`, { disable_web_page_preview: false, message_thread_id: this.threadId });
        } else if (action === 'approve') {
          await this.bot.answerCallbackQuery(query.id, { text: '✅ Approving PR...' });
          // Approve PR via MCP github-work
          await mcpService.callMCP('create_pull_request_review', {
            owner: config.github.owner,
            repo: config.github.repo,
            pull_number: pr.number,
            event: 'APPROVE',
            body: 'Approved via OpenClaw PR Monitor'
          });
          // Mark PR as processed immediately after approval
          const prStateManager = require('./prStateManager');
          await prStateManager.markProcessed(pr.id);
          await this.bot.editMessageText(`✅ PR #${pr.number} has been successfully approved!`, {
            chat_id: this.chatId,
            message_id: query.message.message_id,
            message_thread_id: this.threadId
          });
          logger.info(`PR #${pr.number} approved successfully and marked as processed`);
        } else if (action === 'reject') {
          await this.bot.answerCallbackQuery(query.id, { text: '❌ Rejecting PR...' });
          // Add rejection comment and request changes
          try {
            await mcpService.callMCP('create_pull_request_review', {
              owner: config.github.owner,
              repo: config.github.repo,
              pull_number: pr.number,
              event: 'REQUEST_CHANGES',
              body: 'Changes requested via OpenClaw PR Monitor. Minimal 2 reviewers required, 1 approved so far.'
            });
            await this.bot.editMessageText(`❌ PR #${pr.number} changes requested. Waiting for additional approvals (min 2 total required).`, {
              chat_id: this.chatId,
              message_id: query.message.message_id,
              message_thread_id: this.threadId
            });
            logger.info(`PR #${pr.number} changes requested`);
          } catch (error) {
            // Handle GitHub API restriction: Can not request changes on your own pull request
            if (error.message.includes('Can not request changes on your own pull request')) {
              logger.warn(`Cannot request changes on own PR #${pr.number}, posting as COMMENT instead`);
              // Fallback to COMMENT
              await mcpService.callMCP('create_pull_request_review', {
                owner: config.github.owner,
                repo: config.github.repo,
                pull_number: pr.number,
                event: 'COMMENT',
                body: '⚠️ Cannot request changes on your own PR (GitHub restriction). Posted as comment instead.\n\nChanges requested via OpenClaw PR Monitor. Minimal 2 reviewers required, 1 approved so far.'
              });
              // Inform user about the limitation
              await this.bot.editMessageText(`⚠️ Cannot request changes on own PR (GitHub restriction). Posted as comment instead.\n\nPR #${pr.number} - Changes requested (min 2 reviewers required, 1 approved so far).`, {
                chat_id: this.chatId,
                message_id: query.message.message_id,
                message_thread_id: this.threadId
              });
              logger.info(`PR #${pr.number} rejection posted as COMMENT due to own PR restriction`);
            } else {
              throw error; // Re-throw other errors
            }
          }
        } else if (action === 'close') {
          await this.bot.answerCallbackQuery(query.id, { text: '🔒 Closing PR...' });
          // Close PR via MCP
          await mcpService.callMCP('update_pull_request', {
            owner: config.github.owner,
            repo: config.github.repo,
            pull_number: pr.number,
            state: 'closed'
          });
          await this.bot.editMessageText(`🔒 PR #${pr.number} has been closed.`, {
            chat_id: this.chatId,
            message_id: query.message.message_id,
            message_thread_id: this.threadId
          });
          logger.info(`PR #${pr.number} closed successfully`);
        } else if (action === 'skip') {
          await skipManager.addSkip(prIdNum);
          await this.bot.answerCallbackQuery(query.id, { text: '⏸️ PR notifications suppressed for 3 hours' });
          await this.bot.editMessageText(`PR #${prIdNum} notifications have been skipped for 3 hours.`, {
            chat_id: this.chatId,
            message_id: query.message.message_id,
            message_thread_id: this.threadId
          });
        } else if (action === 'review_level') {
          // Format: review_level:prNumber:level
          const level = dataParts[2];
          await this.bot.answerCallbackQuery(query.id, { text: `🚀 Memulai review level ${level}...` });
          await this.bot.sendMessage(this.chatId, `🔄 <b>Sedang melakukan review ${level.toUpperCase()} untuk PR #${prId}</b>\n⏳ Ini mungkin memakan waktu ${config.openclaw.reviewTimeoutMessage}...`, {
            message_thread_id: this.threadId,
            parse_mode: 'HTML'
          });

          // Trigger AI review with level
          logger.info(`Starting AI review for PR #${pr.number} at level ${level}`);
          const reviewResult = await openclawAgentService.runReviewWithLevel(pr, level);
          logger.info(`AI review completed for PR #${pr.number}, got ${reviewResult?.comments?.length || 0} comments`);

          // Post review to GitHub
          logger.info(`Posting review to GitHub for PR #${pr.number}`);
          const ghResult = await mcpService.createReviewWithComments(pr, reviewResult);
          logger.info(`Review posted to GitHub for PR #${pr.number}`);

          // Send confirmation message with error handling
          try {
            const reviewUrl = ghResult?.html_url || pr.url;
            await this.bot.sendMessage(this.chatId,
              `✅ <b>Review Selesai!</b>\n\n` +
              `📝 Level: ${level.toUpperCase()}\n` +
              `💬 Comments: ${reviewResult.comments.length}\n` +
              `🔗 ${reviewUrl}`,
              { message_thread_id: this.threadId, parse_mode: 'HTML' }
            );
            logger.info(`Confirmation message sent to Telegram for PR #${pr.number}`);
          } catch (msgErr) {
            logger.error(`Failed to send confirmation message: ${msgErr.message}`, { stack: msgErr.stack });
            // Try fallback without thread_id
            try {
              const reviewUrl = ghResult?.html_url || pr.url;
              await this.bot.sendMessage(this.chatId,
                `✅ Review Selesai!\n\nLevel: ${level.toUpperCase()}\nComments: ${reviewResult.comments.length}\nLink: ${reviewUrl}`,
                { parse_mode: 'HTML' }
              );
              logger.info(`Fallback confirmation sent for PR #${pr.number}`);
            } catch (fallbackErr) {
              logger.error(`Fallback confirmation also failed: ${fallbackErr.message}`);
            }
          }
        } else if (action === 'review_cancel') {
          await this.bot.answerCallbackQuery(query.id, { text: '❌ Review dibatalkan' });
          await this.bot.deleteMessage(this.chatId, query.message.message_id);
        }
      } catch (err) {
        // Check for specific error: unsupported file types (submodules, special files)
        if (err.message && err.message.includes('cannot be reviewed: contains unsupported file types')) {
          logger.warn(`Cannot review PR #${pr.number}: unsupported file types (submodules, special files)`);
          try {
            await this.bot.answerCallbackQuery(query.id, {
              text: '⚠️ PR contains unsupported file types'
            });
            await this.bot.sendMessage(
              this.chatId,
              `⚠️ <b>Cannot Review PR #${pr.number}</b>\n\n` +
              `This PR contains files that cannot be automatically reviewed (e.g., submodules, removed files, or special file types).\n\n` +
              `🔗 <a href="${pr.url}">View PR on GitHub</a> to review manually.`,
              {
                parse_mode: 'HTML',
                disable_web_page_preview: true,
                message_thread_id: this.threadId,
                reply_to_message_id: query.message?.message_id
              }
            );
          } catch (sendErr) {
            logger.error(`Failed to send unsupported file types message: ${sendErr.message}`);
          }
          return; // Skip generic error handler
        }

        // Generic error handler for all other errors
        logger.error(`Button handler error: ${err.message}`, { stack: err.stack, action: dataParts[0], prId: prId });
        try {
          await this.bot.answerCallbackQuery(query.id, { text: '❌ Action failed, check logs' });
          await this.bot.sendMessage(this.chatId, `❌ Error: ${err.message}`, {
            message_thread_id: this.threadId,
            reply_to_message_id: query.message?.message_id
          });
        } catch (sendErr) {
          logger.error(`Failed to send error message: ${sendErr.message}`);
        }
      }
    }

  /**
   * Stop the Telegram service and clean up resources
   */
  async stop() {
    logger.info('Stopping Telegram service...');

    // Remove event listeners
    if (this.bot) {
      this.bot.off('polling_error', this.pollingErrorHandler);
      this.bot.off('callback_query', this.callbackQueryHandler);

      // Stop polling
      try {
        await this.bot.stopPolling();
        logger.info('Telegram polling stopped');
      } catch (error) {
        logger.error(`Error stopping polling: ${error.message}`);
      }
    }

    // Clear all pending timeouts
    this.timeoutManager.clearAll();
    this.pollingRestartTimeout = null;

    logger.info('Telegram service stopped');
  }

  /**
   * Send PR notification with AI summary and inline buttons (with retries)
   */
  async sendPRNotification(pr, summary) {
    // Escape special MarkdownV2 characters for Telegram
    const escapeMd = (text) => text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
    
    return this.retryOperation(async () => {
      logger.info(`Sending Telegram notification for PR #${pr.number}`);

      const prHeader = escapeMd(`PR #${pr.number}: ${pr.title}`);
      const message = `🔔 <b>NEW PR DETECTED</b>
<b>PR #${pr.number}: ${pr.title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</b>
👤 Author: ${pr.author.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
🔗 URL: ${pr.url}

---
<b>AI PR Summary</b>
📝 Purpose: ${summary.purpose.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
🏷️ Type: ${summary.type.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
⚠️ Risk Level: ${summary.riskLevel.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
🎯 Impact Area: ${summary.impactArea.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
📊 Diff Size: ${summary.diffSize.replace(/</g, '&lt;').replace(/>/g, '&gt;')}
🚨 Suspicious Patterns: ${(summary.suspiciousPatterns?.length ? summary.suspiciousPatterns.join(', ') : 'None detected').replace(/</g, '&lt;').replace(/>/g, '&gt;')}
✅ Recommended Review: ${summary.recommendedReview.replace(/</g, '&lt;').replace(/>/g, '&gt;')}`;

      const inlineKeyboard = {
        inline_keyboard: [
          [{ text: '🔍 Review Now', callback_data: `review_now:${pr.id}` }, { text: '🔗 Visit PR', callback_data: `visit:${pr.id}` }],
          [{ text: '✅ Approve', callback_data: `approve:${pr.id}` }, { text: '❌ Reject', callback_data: `reject:${pr.id}` }],
          [{ text: '🔒 Close PR', callback_data: `close:${pr.id}` }, { text: '⏸️ Skip (3h)', callback_data: `skip:${pr.id}` }]
        ]
      };

      await this.bot.sendMessage(this.chatId, message, {
        reply_markup: inlineKeyboard,
        disable_web_page_preview: true,
        message_thread_id: this.threadId,
        parse_mode: 'HTML'
      });
      logger.info(`Notification sent for PR #${pr.number}`);
    }, config.retries.telegramRetries, 3000, config.retries.backoffFactor);
  }

  /**
   * Send warning notification to Telegram (with retries)
   */
  async sendWarning(prNumber, message) {
    return this.retryOperation(async () => {
      const warningMessage = `⚠️ <b>WARNING</b>

PR #${prNumber}: ${message}`;
      await this.bot.sendMessage(this.chatId, warningMessage, {
        message_thread_id: this.threadId,
        parse_mode: 'HTML'
      });
      logger.info(`Warning notification sent for PR #${prNumber}`);
    }, config.retries.telegramRetries, 3000, config.retries.backoffFactor);
  }
}

module.exports = new TelegramService();
