const TelegramBot = require('node-telegram-bot-api');
const EventEmitter = require('events');
const ITelegramService = require('../../interfaces/ITelegramService');

/**
 * TelegramBotAdapter - Telegram bot operations adapter
 *
 * This adapter implements the ITelegramService interface for sending
 * notifications and managing Telegram bot interactions.
 *
 * It extends EventEmitter to allow external handlers to subscribe to
 * callback queries and other events.
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

    this.bot = null;
    this.chatId = this.config?.app?.telegram?.chatId;

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
    return EventEmitter.prototype.emit.call(this, event, data);
  }

  /**
   * Start the Telegram bot
   * @returns {Promise<void>}
   */
  async start() {
    if (this.bot) {
      this.logger.warn('TelegramBotAdapter already started');
      return;
    }

    this.bot = new TelegramBot(this.botToken, { polling: true });

    // Setup error handler
    this.bot.on('polling_error', (error) => this._handlePollingError(error));

    // Setup callback query handler - emit event for CallbackHandler via Bootstrap
    this.bot.on('callback_query', (query) => {
      this.emit('callback_query', query);
    });

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
      this.bot.stopPolling();
      this.bot = null;
      this.logger.info('TelegramBotAdapter stopped');

      if (this.eventBus) {
        await this.eventBus.emitAsync('telegram.stopped', {
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      this.logger.error(`Error stopping TelegramBotAdapter: ${error.message}`);
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

    return this.retryHelper.retry(async () => {
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
  }

  /**
   * Send an outdated review notification to Telegram
   * @param {OutdatedReviewNotification} notification - Outdated review notification data
   * @returns {Promise<void>}
   */
  async sendOutdatedReviewNotification(notification) {
    const { owner, repo, pr, reviewState, threadId } = notification;

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

    const message = this._buildOutdatedReviewMessage(pr, reviewState);

    return this.retryHelper.retry(async () => {
      const keyboard = [
        [
          { text: '🔍 Review Now', callback_data: `action:${instanceIdx}:${repoIdx}:${pr.id}` },
          { text: '✅ Approve', callback_data: `approve:${instanceIdx}:${repoIdx}:${pr.id}` }
        ],
        [
          { text: '❌ Close PR', callback_data: `close:${instanceIdx}:${repoIdx}:${pr.id}` }
        ],
        [
          { text: '⏸️ Skip (3h)', callback_data: `skip:${instanceIdx}:${repoIdx}:${pr.id}` }
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
      this.instanceMap.set(instanceIdx, { instanceKey, instance });

      let repoIdx = 0;
      for (const repoName of Object.keys(instance.repos || {})) {
        this.repoMap.set(`${instanceIdx}:${repoIdx}`, {
          owner: instance.owner,
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

    return (
      `🔔 <b>New PR: ${this._escapeHtml(pr.title)}</b>\n\n` +
      `📂 <b>Repository:</b> ${this._escapeHtml(pr.author)} → ${this._escapeHtml(pr.baseBranch)}\n` +
      `📊 <b>Risk:</b> ${riskEmojiForLevel} ${this._escapeHtml(summary.riskLevel)} | Impact: ${this._escapeHtml(summary.impactArea)}\n` +
      `📝 <b>Purpose:</b> ${this._escapeHtml(summary.purpose)}\n\n` +
      `📁 <b>Files:</b> ${summary.filesChanged} | 📈 <b>Changes:</b> ${summary.diffSize}`
    );
  }

  /**
   * Build outdated review notification message
   * @param {PullRequest} pr - Pull request object
   * @param {ReviewState} reviewState - Review state
   * @returns {string} Formatted message
   * @private
   */
  _buildOutdatedReviewMessage(pr, reviewState) {
    return (
      `⚠️ <b>Outdated Review Detected</b>\n\n` +
      `📌 <b>PR #${pr.number}:</b> ${this._escapeHtml(pr.title)}\n` +
      `👤 <b>Author:</b> ${this._escapeHtml(pr.author)}\n\n` +
      `❗ <b>This PR has new commits since the last review.</b>\n` +
      `Please review the latest changes.`
    );
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
        { text: '🔍 Review Now', callback_data: `action:${instanceIdx}:${repoIdx}:${pr.id}` },
        { text: '✅ Approve', callback_data: `approve:${instanceIdx}:${repoIdx}:${pr.id}` }
      ],
      [
        { text: '❌ Request Changes', callback_data: `reject:${instanceIdx}:${repoIdx}:${pr.id}` },
        { text: '🔒 Close PR', callback_data: `close:${instanceIdx}:${repoIdx}:${pr.id}` }
      ],
      [
        { text: '⏸️ Skip (3h)', callback_data: `skip:${instanceIdx}:${repoIdx}:${pr.id}` }
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
}

module.exports = TelegramBotAdapter;
