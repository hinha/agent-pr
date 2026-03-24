const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const logger = require('../utils/logger');
const skipManager = require('./skipManager');
const openclawAgentService = require('./openclawAgentService');
const prStateManager = require('./prStateManager');

class TelegramService {
  constructor() {
    this.bot = new TelegramBot(config.telegram.botToken, { polling: true });
    this.chatId = config.telegram.chatId;
    this.threadId = config.telegram.threadId;
    this.setupButtonHandlers();
    logger.info('Telegram bot initialized successfully with active polling for button interactions');
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
    this.bot.on('callback_query', async (query) => {
      const [action, prId] = query.data.split(':');
      const prIdNum = parseInt(prId);

      try {
        // Fetch PR data first for all actions
        const mcpService = require('./mcpGithubService');
        const openPRs = await mcpService.getOpenPRs();
        const pr = openPRs.find(p => p.id === prIdNum);
        if (!pr) throw new Error(`PR #${prId} not found`);

        if (action === 'review_now') {
          await this.bot.answerCallbackQuery(query.id, { text: '🚀 Memulai proses review PR...' });
          await this.bot.sendMessage(this.chatId, `🚀 **Memulai review untuk PR #${pr.number}**\n🔗 Link PR: ${pr.url}\nSilakan lakukan review manual pada perubahan kode di GitHub, setelah selesai kamu bisa tekan tombol ✅ Approve jika sudah oke.`, { disable_web_page_preview: false, message_thread_id: this.threadId, parse_mode: 'HTML' });
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
        }
      } catch (err) {
        logger.error(`Button handler error: ${err.message}`);
        await this.bot.answerCallbackQuery(query.id, { text: '❌ Action failed, check logs' });
      }
    });
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
   * Send full review result to Telegram
   */
  async sendReviewResult(pr, review) {
    const escapeMd = (text) => text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
    const reviewText = `✅ *Full AI Review for PR #${pr.number}*
${escapeMd(JSON.stringify(review, null, 2).substring(0, 4000))}`;
    await this.bot.sendMessage(this.chatId, reviewText, { disable_web_page_preview: true, message_thread_id: this.threadId, parse_mode: 'MarkdownV2' });
  }
}

module.exports = new TelegramService();
