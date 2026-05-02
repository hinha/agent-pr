/**
 * ConfirmationManager - Manages pending approval confirmations with timeout
 *
 * Tracks in-flight confirmation prompts (Yes/No) for the Approve action.
 * Each confirmation has a configurable timeout after which the keyboard
 * is automatically reverted to its original state.
 *
 * State is kept in-memory only (no persistence) because confirmation
 * prompts are a short-lived UX concern, not business state.
 */
class ConfirmationManager {
  /**
   * @param {Object} logger - Logger instance
   * @param {Object} timeoutManager - TimeoutManager for tracked timers
   * @param {Object} config - Application config
   */
  constructor(logger, timeoutManager, config) {
    this.logger = logger;
    this.timeoutManager = timeoutManager;
    this.config = config;

    /** @type {Map<string, {originalKeyboard: Array, actionType: string, extraData: Object, timerId: Object}>} */
    this.pendingConfirmations = new Map();

    this._bot = null;
  }

  /**
   * Set the Telegram bot instance (for timeout callback edits)
   * @param {Object} bot - node-telegram-bot-api instance
   */
  setBot(bot) {
    this._bot = bot;
  }

  /**
   * Get the configured timeout duration in milliseconds
   * @returns {number} Timeout in ms (default: 10 minutes)
   */
  getTimeoutMs() {
    const minutes = parseInt(
      this.config?.app?.approve_confirmation_timeout_minutes,
      10
    );
    return (Number.isNaN(minutes) ? 10 : minutes) * 60 * 1000;
  }

  /**
   * Add a pending confirmation
   *
   * @param {string|number} chatId
   * @param {number} messageId
   * @param {Array} originalKeyboard - The original inline_keyboard to restore
   * @param {string} actionType - 'approve' or 'approve_outdated'
   * @param {Object} extraData - Extra data (e.g. { reviewId })
   */
  add(chatId, messageId, originalKeyboard, actionType, extraData = {}) {
    const key = `${chatId}:${messageId}`;

    // Clear any existing confirmation for the same message
    if (this.pendingConfirmations.has(key)) {
      const existing = this.pendingConfirmations.get(key);
      this.timeoutManager.clearTimeout(existing.timerId);
    }

    const timerId = this.timeoutManager.setTimeout(() => {
      this._onTimeout(key, chatId, messageId);
    }, this.getTimeoutMs());

    this.pendingConfirmations.set(key, {
      originalKeyboard,
      actionType,
      extraData,
      timerId
    });

    this.logger.debug(
      `[ConfirmationManager] Confirmation added for ${key}, timeout=${this.getTimeoutMs()}ms`
    );
  }

  /**
   * Atomically consume (retrieve and remove) a pending confirmation.
   * Returns null if the confirmation has expired or doesn't exist.
   *
   * @param {string|number} chatId
   * @param {number} messageId
   * @returns {Object|null} The confirmation data or null
   */
  consume(chatId, messageId) {
    const key = `${chatId}:${messageId}`;
    const entry = this.pendingConfirmations.get(key);

    if (!entry) {
      return null;
    }

    // Clear the timeout and remove from map
    this.timeoutManager.clearTimeout(entry.timerId);
    this.pendingConfirmations.delete(key);

    return {
      originalKeyboard: entry.originalKeyboard,
      actionType: entry.actionType,
      extraData: entry.extraData
    };
  }

  /**
   * Clear all pending confirmations (for shutdown)
   */
  clearAll() {
    for (const [, entry] of this.pendingConfirmations) {
      this.timeoutManager.clearTimeout(entry.timerId);
    }
    this.pendingConfirmations.clear();
    this.logger.debug('[ConfirmationManager] All confirmations cleared');
  }

  /**
   * Get count of pending confirmations
   * @returns {number}
   */
  getPendingCount() {
    return this.pendingConfirmations.size;
  }

  /**
   * Handle timeout - restore original keyboard
   * @param {string} key - Map key
   * @param {string|number} chatId
   * @param {number} messageId
   * @private
   */
  async _onTimeout(key, chatId, messageId) {
    const entry = this.pendingConfirmations.get(key);
    if (!entry) {
      return;
    }

    this.pendingConfirmations.delete(key);

    if (!this._bot || !entry.originalKeyboard) {
      this.logger.debug(`[ConfirmationManager] Cannot restore keyboard for ${key}: bot or keyboard unavailable`);
      return;
    }

    try {
      await this._bot.editMessageReplyMarkup(
        { inline_keyboard: entry.originalKeyboard },
        { chat_id: chatId, message_id: messageId }
      );
      this.logger.info(`[ConfirmationManager] Confirmation expired, keyboard restored for ${key}`);
    } catch (error) {
      // "message not modified" is expected if user already interacted
      if (!error.message?.includes('message is not modified')) {
        this.logger.warn(
          `[ConfirmationManager] Failed to restore keyboard for ${key}: ${error.message}`
        );
      }
    }
  }
}

module.exports = ConfirmationManager;
