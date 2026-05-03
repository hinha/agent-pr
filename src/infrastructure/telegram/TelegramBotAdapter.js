const TelegramBot = require('node-telegram-bot-api');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const ITelegramService = require('../../interfaces/ITelegramService');

// File lock path - ensures only one instance polls
const LOCK_FILE = path.join(process.cwd(), 'data', '.telegram-polling.lock');

/**
 * TelegramBotAdapter - Telegram bot operations adapter
 *
 * This adapter implements the ITelegramService interface for sending
 * notifications and managing Telegram bot interactions.
 *
 * It extends EventEmitter to allow external handlers to subscribe to
 * callback queries and other events.
 *
 * Uses file locking to ensure only ONE instance polls the Telegram bot.
 * Multiple instances can coexist, but only the lock holder will poll.
 *
 * @example
 * const adapter = new TelegramBotAdapter(config, logger, retryHelper);
 * adapter.on('callback_query', async (query) => { ... });
 * await adapter.start();
 */
class TelegramBotAdapter extends ITelegramService {
  /**
   * @param {string} botToken - Telegram bot token
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Winston logger instance
   * @param {Object} options.retryHelper - RetryHelper instance
   * @param {Object} options.config - Full application config
   */
  constructor(botToken, options = {}) {
    super();
    this.botToken = botToken;
    this.logger = options.logger || console;
    this.retryHelper = options.retryHelper;
    this.config = options.config;
    this.eventBus = options.eventBus || null;

    // Singleton: ensure lock directory exists
    this._ensureLockDir();

    // Try to acquire lock for polling
    this.isPollingOwner = this._acquireLock();
    this.lockFd = null;

    // EAGER instantiation - create bot immediately
    // Only the lock holder should enable polling
    this.bot = new TelegramBot(this.botToken, { polling: this.isPollingOwner });
    this.chatId = this.config?.app?.telegram?.chatId;

    if (!this.isPollingOwner) {
      this.logger.info('TelegramBotAdapter initialized in NON-POLLING mode (another instance owns the lock)');
    }

    // Setup event handlers immediately
    this.bot.on('polling_error', (error) => this._handlePollingError(error));
    this.bot.on('callback_query', (query) => {
      this.logger.info(`[TelegramBotAdapter] Received callback_query: ${query.data}`);
      this.emit('callback_query', query);
    });
    this.bot.on('message', (message) => {
      this.logger.info(`[TelegramBotAdapter] Received message: ${message.text}`);
      this.emit('message', message);
    });

    // Store lock fd for cleanup
    if (this.isPollingOwner) {
      this._holdLock();
    }

    // Build instance/repo mapping for compact callback data
    this.instanceMap = new Map();
    this.repoMap = new Map();
    if (this.config) {
      this._buildMapping();
    }

    this.logger.info('TelegramBotAdapter initialized');
  }

  /**
   * Register an event listener (EventEmitter API)
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   * @returns {Function} Unsubscribe function
   */
  on(event, handler) {
    return EventEmitter.prototype.on.call(this, event, handler);
  }

  /**
   * Remove an event listener
   * @param {string} event - Event name
   * @param {Function} handler - Event handler
   * @returns {boolean} True if removed
   */
  off(event, handler) {
    return EventEmitter.prototype.off.call(this, event, handler);
  }

  /**
   * Emit an event
   * @param {string} event - Event name
   * @param {*} data - Event data
   * @returns {boolean} True if event had listeners
   */
  emit(event, data) {
    const hasListeners = EventEmitter.prototype.emit.call(this, event, data);
    if (!hasListeners && event === 'callback_query') {
      this.logger.warn(`[TelegramBotAdapter] Emitted ${event} with no listeners registered`);
    }
    return hasListeners;
  }

  /**
   * Start the Telegram bot
   * @returns {Promise<void>}
   */
  async start() {
    // Bot is already created in constructor - just perform additional setup
    if (this.bot) {
      this.logger.debug('TelegramBotAdapter bot already initialized');
    }

    // Clean webhook to ensure polling mode
    await this._cleanWebhook();

    this.logger.info('TelegramBotAdapter started with active polling');

    // Publish event
    if (this.eventBus) {
      await this.eventBus.emitAsync('telegram.started', {
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Stop the Telegram bot
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.bot) {
      return;
    }

    this.logger.info('Stopping TelegramBotAdapter...');

    try {
      // Stop bot polling
      this.bot.stopPolling();

      // Clear mapping caches
      this.instanceMap.clear();
      this.repoMap.clear();

      // Note: We don't remove event listeners from this adapter's EventEmitter
      // because it extends ITelegramService, not EventEmitter.
      // The adapter's listeners are for external subscribers (Bootstrap).
      // Those will be removed by Bootstrap via off() call.

      // Release lock if we own it
      if (this.isPollingOwner) {
        this._releaseLock();
      }

      this.logger.info('TelegramBotAdapter stopped');

      if (this.eventBus) {
        await this.eventBus.emitAsync('telegram.stopped', {
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      this.logger.error(`Error stopping TelegramBotAdapter: ${error.message}`);
    } finally {
      // Always nullify the bot reference, even on error
      this.bot = null;
    }
  }

  /**
   * Send a PR notification to Telegram
   * @param {PRNotification} notification - PR notification data
   * @returns {Promise<void>}
   */
  async sendPRNotification(notification) {
    const { owner, repo, pr, summary, threadId } = notification;

    this.logger.info(`[TelegramBotAdapter] Sending PR notification for ${owner}/${repo} PR #${pr.number}`);

    // Ensure bot is initialized
    if (!this.bot) {
      throw new Error('Telegram bot not initialized. Call start() before sending notifications.');
    }

    const result = this._getRepoIndices(owner, repo);
    if (!result) {
      throw new Error(`No indices found for ${owner}/${repo}`);
    }
    const { instanceIdx, repoIdx } = result;

    // Get instance configuration
    const instance = this.instanceMap.get(instanceIdx)?.instance;
    if (!instance) {
      throw new Error(`No instance found for index ${instanceIdx}`);
    }

    const message = this._buildPRMessage(pr, summary, instance);

    try {
      await this.retryHelper.retry(async () => {
        const keyboard = this._buildPRKeyboard(instanceIdx, repoIdx, pr);

        await this.bot.sendMessage(this.chatId, message, {
          reply_markup: { inline_keyboard: keyboard },
          message_thread_id: threadId,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        });

        this.logger.info(`[TelegramBotAdapter] PR notification sent for ${owner}/${repo} PR #${pr.number}`);
      }, {
        retries: 3,
        minTimeout: 1000,
        factor: 2,
        context: 'TelegramBotAdapter.sendPRNotification'
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`[TelegramBotAdapter] Failed to send PR notification: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send an outdated review notification to Telegram
   * @param {OutdatedReviewNotification} notification - Outdated review notification data
   * @returns {Promise<void>}
   */
  async sendOutdatedReviewNotification(notification) {
    const {
      owner, repo, pr, reviewState, reviewUser, reviewBody,
      outdatedCommit, currentCommit, threadId
    } = notification;

    this.logger.info(`[TelegramBotAdapter] Sending outdated review notification for ${owner}/${repo} PR #${pr.number}`);

    // Ensure bot is initialized
    if (!this.bot) {
      throw new Error('Telegram bot not initialized. Call start() before sending notifications.');
    }

    const result = this._getRepoIndices(owner, repo);
    if (!result) {
      throw new Error(`No indices found for ${owner}/${repo}`);
    }
    const { instanceIdx, repoIdx } = result;

    const message = this._buildOutdatedReviewMessage(pr, {
      reviewState, reviewUser, outdatedCommit, currentCommit, owner
    });

    try {
      await this.retryHelper.retry(async () => {
        // Get review ID from reviewState if available
        const reviewId = reviewState?.reviewId || reviewState?.id || pr.id;

        const keyboard = [
          [
            { text: '✅ Approve', callback_data: `approve_outdated:${instanceIdx}:${repoIdx}:${pr.id}:${reviewId}` },
            { text: '🔍 Re-review', callback_data: `re_review:${instanceIdx}:${repoIdx}:${pr.id}:${reviewId}` }
          ],
          [
            { text: '🔗 Visit PR', callback_data: `visit:${instanceIdx}:${repoIdx}:${pr.id}` },
            { text: '❌ Dismiss', callback_data: `dismiss_outdated:${instanceIdx}:${repoIdx}:${pr.id}:${reviewId}` }
          ]
        ];

        await this.bot.sendMessage(this.chatId, message, {
          reply_markup: { inline_keyboard: keyboard },
          message_thread_id: threadId,
          parse_mode: 'HTML',
          disable_web_page_preview: true
        });

        this.logger.info(`[TelegramBotAdapter] Outdated review notification sent for ${owner}/${repo} PR #${pr.number}`);
      }, {
        retries: 3,
        minTimeout: 1000,
        factor: 2,
        context: 'TelegramBotAdapter.sendOutdatedReviewNotification'
      });

      return { success: true };
    } catch (error) {
      this.logger.error(`[TelegramBotAdapter] Failed to send outdated review notification: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get the underlying Telegram bot instance
   * @returns {TelegramBot} Bot instance
   */
  getBot() {
    return this.bot;
  }

  // ===== Private Methods =====

  /**
   * Build mapping for compact callback data format
   * @private
   */
  _buildMapping() {
    let instanceIdx = 0;
    for (const [instanceKey, instance] of Object.entries(this.config.instances)) {
      // Extract owner from instance key if not explicitly defined
      // Format: github/org-name → owner = org-name
      const owner = instance.owner || instanceKey.split('/')[1];
      this.instanceMap.set(instanceIdx, { instanceKey, instance, owner });

      let repoIdx = 0;
      for (const repoName of Object.keys(instance.repos || {})) {
        this.repoMap.set(`${instanceIdx}:${repoIdx}`, {
          owner: owner,
          repo: repoName,
          instanceKey,
          instance
        });
        repoIdx++;
      }

      instanceIdx++;
    }
    this.logger.info(`Built mapping for ${this.instanceMap.size} instances, ${this.repoMap.size} repos`);
  }

  /**
   * Get repo info from compact indices
   * @param {number} instanceIdx - Instance index
   * @param {number} repoIdx - Repository index
   * @returns {Object|null} Repository info
   * @private
   */
  _getRepoInfo(instanceIdx, repoIdx) {
    return this.repoMap.get(`${instanceIdx}:${repoIdx}`);
  }

  /**
   * Get instance and repo indices for a given owner/repo
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {Object|null} Indices object
   * @private
   */
  _getRepoIndices(owner, repo) {
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
   * @private
   */
  async _cleanWebhook() {
    try {
      if (typeof this.bot.deleteWebhook === 'function') {
        await this.bot.deleteWebhook({ drop_pending_updates: false });
        this.logger.info('Webhook deleted, ensuring polling mode');
      } else {
        this.logger.debug('deleteWebhook not available, skipping webhook cleanup');
      }
    } catch (err) {
      this.logger.warn(`Failed to delete webhook: ${err.message}`);
    }
  }

  /**
   * Handle polling errors
   * @param {Error} error - Polling error
   * @private
   */
  async _handlePollingError(error) {
    // Suppress 409 errors in non-polling mode (expected)
    if (!this.isPollingOwner && error.code === 'ETELEGRAM' && error.message.includes('409')) {
      // Silently ignore - we're not polling anyway
      return;
    }

    this.logger.error(`Polling error: ${error.code} - ${error.message}`);

    if (error.code === 'ETELEGRAM' && error.message.includes('409')) {
      this.logger.warn('Detected multiple polling instances. Backing off...');
    }

    if (this.eventBus) {
      await this.eventBus.emitAsync('telegram.polling_error', {
        code: error.code,
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * Build PR notification message
   * @param {PullRequest} pr - Pull request object
   * @param {PRSummary} summary - PR summary
   * @param {Object} instance - Instance configuration
   * @returns {string} Formatted message
   * @private
   */
  _buildPRMessage(pr, summary, instance) {
    const riskEmoji = {
      'LOW': '🟢',
      'MEDIUM': '🟡',
      'HIGH': '🔴'
    };

    const riskEmojiForLevel = riskEmoji[summary.riskLevel] || '⚪';

    const createdAt = pr.createdAt
      ? new Date(pr.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      : null;

    let message =
      `🔔 <b>New PR: ${this._escapeHtml(pr.title)}</b>\n\n` +
      `📂 <b>Repository:</b> ${this._escapeHtml(pr.owner)} → ${this._escapeHtml(pr.repo)}\n` +
      `📊 <b>Risk:</b> ${riskEmojiForLevel} ${this._escapeHtml(summary.riskLevel)}\n` +
      `💥 <b>Impact:</b> ${this._escapeHtml(summary.impactArea)}\n` +
      `📝 <b>Purpose:</b> ${this._escapeHtml(summary.purpose)}\n`;

    if (createdAt) {
      message += `📅 <b>Created:</b> ${createdAt} WIB\n`;
    }

    message += `\n📁 <b>Files:</b> ${summary.filesChanged} | 📈 <b>Changes:</b> ${summary.diffSize}`;

    return message;
  }

  /**
   * Build outdated review notification message
   * @param {PullRequest} pr - Pull request object
   * @param {Object} context - Additional context
   * @param {string} context.reviewState - Review state (APPROVED, COMMENTED, etc.)
   * @param {string} [context.reviewUser] - Reviewer username
   * @param {string} [context.outdatedCommit] - SHA of the reviewed commit
   * @param {string} [context.currentCommit] - SHA of the current HEAD commit
   * @param {string} [context.owner] - Repository owner
   * @param {number} [context.reviewCount] - Number of outdated reviews
   * @param {Array<string>} [context.reviewers] - List of reviewer usernames
   * @returns {string} Formatted message
   * @private
   */
  _buildOutdatedReviewMessage(pr, context = {}) {
    const { reviewState, reviewUser, outdatedCommit, currentCommit, owner, reviewCount, reviewers } = context;

    const shortSha = (sha) => sha ? sha.substring(0, 7) : 'unknown';

    const stateEmoji = {
      'APPROVED': '✅',
      'CHANGES_REQUESTED': '❌',
      'COMMENTED': '💬',
      'PENDING': '⏳'
    };

    const stateLabel = reviewState || 'UNKNOWN';
    const emoji = stateEmoji[stateLabel] || '📝';

    const count = reviewCount || 1;
    const countLabel = count > 1 ? `${count} outdated reviews` : 'Outdated Review Detected';

    const createdAt = pr.createdAt
      ? new Date(pr.createdAt).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      : null;

    let message =
      `⚠️ <b>${countLabel}</b>\n\n` +
      `📂 <b>Repo:</b> ${this._escapeHtml(owner)}/${this._escapeHtml(pr.repo)}\n` +
      `📌 <b>PR #${pr.number}:</b> ${this._escapeHtml(pr.title)}\n` +
      `👤 <b>Author:</b> ${this._escapeHtml(pr.author)}\n`;

    if (createdAt) {
      message += `📅 <b>Created:</b> ${createdAt} WIB\n`;
    }

    if (reviewers && reviewers.length > 0) {
      const reviewerList = reviewers.map(r => this._escapeHtml(r)).join(', ');
      message += `🔍 <b>Reviewers:</b> ${reviewerList}\n`;
    } else if (reviewUser) {
      message += `🔍 <b>Reviewed by:</b> ${this._escapeHtml(reviewUser)} ${emoji} ${this._escapeHtml(stateLabel)}\n`;
    }

    message += `\n🔄 <b>New commits since review:</b>\n` +
      `   <code>${shortSha(outdatedCommit)}</code> → <code>${shortSha(currentCommit)}</code>\n`;

    if (pr.headBranch && pr.baseBranch) {
      message += `🔀 <b>Branch:</b> ${this._escapeHtml(pr.headBranch)} → ${this._escapeHtml(pr.baseBranch)}\n`;
    }

    message += `\n❗ <b>Please re-review the latest changes.</b>`;

    return message;
  }

  /**
   * Build PR keyboard with action buttons
   * @param {number} instanceIdx - Instance index
   * @param {number} repoIdx - Repository index
   * @param {PullRequest} pr - Pull request object
   * @returns {Array} Keyboard layout
   * @private
   */
  _buildPRKeyboard(instanceIdx, repoIdx, pr) {
    return [
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
        { text: '🔇 Silent', callback_data: `silent:${instanceIdx}:${repoIdx}:${pr.id}` }
      ]
    ];
  }

  /**
   * Escape HTML special characters
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   * @private
   */
  _escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ===== Lock Management (Singleton Pattern) =====

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
   * Try to acquire the polling lock
   * Returns true if lock acquired, false otherwise
   * @private
   */
  _acquireLock() {
    try {
      // Try exclusive lock (O_EXCL) - fails if file exists
      this.lockFd = fs.openSync(LOCK_FILE, 'wx');
      // Write PID to lock file
      fs.writeSync(this.lockFd, String(process.pid));
      this.logger.info(`[TelegramBotAdapter] Acquired polling lock (PID: ${process.pid})`);
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') {
        // Lock file exists - check if process is still alive
        try {
          const pid = parseInt(fs.readFileSync(LOCK_FILE, 'utf8').trim());
          // Check if process exists (try sending signal 0)
          process.kill(pid, 0);
          // Process still alive, we can't acquire lock
          this.logger.info(`[TelegramBotAdapter] Lock held by PID ${pid}, running in non-polling mode`);
          return false;
        } catch (readErr) {
          if (readErr.code === 'ESRCH' || readErr.code === 'ENOENT') {
            // Process dead or lock file gone, try to acquire stale lock
            try {
              fs.unlinkSync(LOCK_FILE);
              this.lockFd = fs.openSync(LOCK_FILE, 'wx');
              fs.writeSync(this.lockFd, String(process.pid));
              this.logger.info(`[TelegramBotAdapter] Cleaned stale lock, acquired polling lock (PID: ${process.pid})`);
              return true;
            } catch (retryErr) {
              this.logger.warn(`[TelegramBotAdapter] Could not acquire lock after cleanup: ${retryErr.message}`);
              return false;
            }
          }
          return false;
        }
      }
      this.logger.warn(`[TelegramBotAdapter] Lock acquisition error: ${err.message}`);
      return false;
    }
  }

  /**
   * Hold the lock - keep file descriptor open
   * @private
   */
  _holdLock() {
    // Lock is held as long as fd is open
    this.logger.debug('[TelegramBotAdapter] Holding polling lock');
  }

  /**
   * Release the polling lock
   * @private
   */
  _releaseLock() {
    try {
      if (this.lockFd !== null) {
        fs.closeSync(this.lockFd);
        this.lockFd = null;
      }
      if (fs.existsSync(LOCK_FILE)) {
        fs.unlinkSync(LOCK_FILE);
      }
      this.logger.info('[TelegramBotAdapter] Released polling lock');
    } catch (err) {
      this.logger.warn(`[TelegramBotAdapter] Lock release error: ${err.message}`);
    }
  }
}

module.exports = TelegramBotAdapter;
