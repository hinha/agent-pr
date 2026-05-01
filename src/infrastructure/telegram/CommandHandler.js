/**
 * CommandHandler - Handles Telegram bot text commands
 *
 * This handler processes text commands like /reset, /status, etc.
 * Commands are scoped by thread_id to prevent cross-repo operations.
 *
 * @example
 * const handler = new CommandHandler(stateMachine, stateRepositoryFactory, { logger, config, bot, chatId });
 * await handler.handleCommand(message, config);
 */

class CommandHandler {
  /**
   * @param {Object} stateMachine - PRStateMachine instance
   * @param {Object} stateRepositoryFactory - StateRepository factory
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   * @param {Object} options.config - Full application config
   * @param {Object} options.bot - Telegram bot instance
   * @param {number} options.chatId - Telegram chat ID
   */
  constructor(stateMachine, stateRepositoryFactory, options = {}) {
    this.stateMachine = stateMachine;
    this.stateRepositoryFactory = stateRepositoryFactory;
    this.logger = options.logger || console;
    this.config = options.config || null;
    this.bot = options.bot || null;
    this.chatId = options.chatId || null;
  }

  /**
   * Handle a text command from Telegram
   *
   * @param {Object} message - Telegram message object
   * @param {Object} config - Full configuration with instances
   * @returns {Promise<Object>} Handler result
   */
  async handleCommand(message, config) {
    const { text, message_thread_id } = message;

    if (!text || !text.startsWith('/')) {
      return { success: true, action: 'ignored' };
    }

    // Parse command
    const parts = text.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    this.logger.debug(`[CommandHandler] Processing command: ${command}, args: ${args.join(' ')}`);

    // Find repo by thread_id to ensure commands are repo-scoped
    const { instance, repo } = this._findRepoByThreadId(message_thread_id, config);
    if (!instance || !repo) {
      this.logger.warn(`[CommandHandler] No repo found for thread_id: ${message_thread_id}`);
      await this._replyMessage(message, '⚠️ Command tidak valid di thread ini.');
      return { success: false, error: 'Thread not associated with any repo' };
    }

    let result;

    // Route to command handler
    switch (command) {
      case '/reset':
        result = await this._handleReset(args, instance, repo, message);
        break;

      case '/status':
        result = await this._handleStatus(args, instance, repo, message);
        break;

      case '/help':
        result = await this._handleHelp(message);
        break;

      default:
        await this._replyMessage(message, `❌ Unknown command: ${command}\nGunakan /help untuk melihat command yang tersedia.`);
        result = { success: false, error: 'Unknown command' };
    }

    // Emit command handled event
    await this.stateMachine.eventBus?.emitAsync('command.handled', {
      command,
      instanceKey: instance.key,
      repoName: repo.name,
      args,
      result
    });

    return result;
  }

  /**
   * Find instance and repo by thread_id
   * @private
   */
  _findRepoByThreadId(threadId, config) {
    if (!threadId || !config) {
      return { instance: null, repo: null };
    }

    for (const [instanceKey, instanceConfig] of Object.entries(config.instances)) {
      if (!instanceConfig.repos) continue;

      for (const [repoName, repoConfig] of Object.entries(instanceConfig.repos)) {
        if (repoConfig.thread_id === threadId) {
          return {
            instance: {
              ...instanceConfig,
              key: instanceKey,
              owner: instanceKey.split('/')[1]
            },
            repo: {
              name: repoName,
              threadId: repoConfig.thread_id
            }
          };
        }
      }
    }

    return { instance: null, repo: null };
  }

  /**
   * Handle /reset command - Reset PR state
   * @private
   */
  async _handleReset(args, instance, repo, message) {
    if (args.length !== 1) {
      await this._replyMessage(message, '❌ Usage: /reset <pr_number>\nContoh: /reset 9');
      return { success: false, error: 'Invalid arguments' };
    }

    const prNumber = parseInt(args[0], 10);
    if (isNaN(prNumber) || prNumber <= 0) {
      await this._replyMessage(message, '❌ Invalid PR number. Gunakan: /reset <pr_number>');
      return { success: false, error: 'Invalid PR number' };
    }

    try {
      this.logger.info(
        `[CommandHandler] Resetting PR #${prNumber} in ${instance.key}/${repo.name}`
      );

      // Reset state machine
      await this.stateMachine.reset(instance.key, repo.name, prNumber);

      // Clear from notification_counts.json
      const stateRepository = this.stateRepositoryFactory.create(instance.owner, repo.name);
      await stateRepository._persistNotificationCount(prNumber, 0);

      // Clear from processed_prs.json
      await stateRepository.clearProcessed(instance.owner, repo.name, prNumber);

      // Also clear review state if exists
      await stateRepository.clearReviewState(prNumber);

      await this._replyMessage(message, `✅ PR #${prNumber} state has been reset.\n\nPR ini akan diproses ulang pada polling berikutnya.`);

      this.logger.info(`[CommandHandler] PR #${prNumber} reset complete`);

      return {
        success: true,
        action: 'reset',
        prNumber
      };
    } catch (error) {
      this.logger.error(`[CommandHandler] Error resetting PR #${prNumber}:`, error);
      await this._replyMessage(message, `❌ Gagal reset PR #${prNumber}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle /status command - Show PR status
   * @private
   */
  async _handleStatus(args, instance, repo, message) {
    if (args.length !== 1) {
      await this._replyMessage(message, '❌ Usage: /status <pr_number>\nContoh: /status 9');
      return { success: false, error: 'Invalid arguments' };
    }

    const prNumber = parseInt(args[0], 10);
    if (isNaN(prNumber) || prNumber <= 0) {
      await this._replyMessage(message, '❌ Invalid PR number. Gunakan: /status <pr_number>');
      return { success: false, error: 'Invalid PR number' };
    }

    try {
      const state = await this.stateMachine.getState(instance.key, repo.name, prNumber);
      const count = await this.stateMachine.getNotificationCount(instance.key, repo.name, prNumber);
      const isProcessed = this.stateMachine.isTerminalState(state);

      const statusMsg =
        `📊 <b>Status PR #${prNumber}</b>\n\n` +
        `🔹 <b>State:</b> ${state.toUpperCase()}\n` +
        `🔹 <b>Notifications:</b> ${count}/${this.stateMachine.maxNotifications}\n` +
        `🔹 <b>Processed:</b> ${isProcessed ? 'Yes ✅' : 'No ❌'}`;

      await this._replyMessage(message, statusMsg);

      return {
        success: true,
        action: 'status',
        prNumber,
        state,
        count,
        isProcessed
      };
    } catch (error) {
      this.logger.error(`[CommandHandler] Error getting status for PR #${prNumber}:`, error);
      await this._replyMessage(message, `❌ Gagal mendapatkan status PR #${prNumber}: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle /help command - Show available commands
   * @private
   */
  async _handleHelp(message) {
    const helpMsg =
      `📖 <b>Available Commands</b>\n\n` +
      `/reset &lt;pr_number&gt;\n` +
      `  Reset state PR agar diproses ulang.\n` +
      `  Contoh: /reset 9\n\n` +
      `/status &lt;pr_number&gt;\n` +
      `  Lihat status PR saat ini.\n` +
      `  Contoh: /status 9\n\n` +
      `⚠️ <b>Note:</b> Command bekerja di dalam thread repo saja.`;

    await this._replyMessage(message, helpMsg);

    return {
      success: true,
      action: 'help'
    };
  }

  /**
   * Send reply message
   * @private
   */
  async _replyMessage(originalMessage, text) {
    if (!this.bot || !this.chatId) {
      this.logger.warn('[CommandHandler] Cannot reply: bot or chatId not set');
      return;
    }

    try {
      await this.bot.sendMessage(
        this.chatId,
        text,
        {
          parse_mode: 'HTML',
          message_thread_id: originalMessage.message_thread_id,
          reply_to_message_id: originalMessage.message_id
        }
      );
    } catch (error) {
      this.logger.error(`[CommandHandler] Failed to send reply: ${error.message}`);
    }
  }
}

module.exports = CommandHandler;
