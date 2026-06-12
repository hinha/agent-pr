/**
 * Routes notifications to all enabled notification platforms.
 */
class NotificationRouter {
  constructor(options = {}) {
    this.telegramAdapter = options.telegramAdapter || null;
    this.discordAdapter = options.discordAdapter || null;
    this.config = options.config || {};
    this.logger = options.logger || console;
  }

  async sendPRNotification(notification) {
    return this._fanOut('sendPRNotification', notification);
  }

  async sendOutdatedReviewNotification(notification) {
    return this._fanOut('sendOutdatedReviewNotification', notification);
  }

  async sendQueueCompletedNotification(data) {
    return this._fanOut('sendQueueCompletedNotification', data, {
      telegramFallback: () => this._sendTelegramQueueCompleted(data)
    });
  }

  async sendQueueFailedNotification(data) {
    return this._fanOut('sendQueueFailedNotification', data, {
      telegramFallback: () => this._sendTelegramQueueFailed(data)
    });
  }

  async sendToThread(threadId, message) {
    const targets = [];

    if (this._telegramEnabled() && this.telegramAdapter?.sendToThread) {
      targets.push(this._executeTarget('telegram', () => this.telegramAdapter.sendToThread(threadId, message)));
    }

    const results = await Promise.all(targets);
    return this._aggregate(results);
  }

  async _fanOut(methodName, payload, options = {}) {
    const targets = [];

    if (this._telegramEnabled() && this.telegramAdapter) {
      if (typeof this.telegramAdapter[methodName] === 'function') {
        targets.push(this._executeTarget('telegram', () => this.telegramAdapter[methodName](payload)));
      } else if (options.telegramFallback) {
        targets.push(this._executeTarget('telegram', options.telegramFallback));
      }
    }

    if (this._discordEnabled() && this.discordAdapter && typeof this.discordAdapter[methodName] === 'function') {
      targets.push(this._executeTarget('discord', () => this.discordAdapter[methodName](payload)));
    }

    if (targets.length === 0) {
      return { success: false, error: `No notification targets available for ${methodName}`, results: [] };
    }

    const results = await Promise.all(targets);
    return this._aggregate(results);
  }

  async _executeTarget(platform, fn) {
    try {
      const result = await fn();
      return {
        platform,
        success: result?.success !== false,
        result
      };
    } catch (error) {
      this.logger.error(`[NotificationRouter] ${platform} notification failed: ${error.message}`);
      return {
        platform,
        success: false,
        error: error.message
      };
    }
  }

  _aggregate(results) {
    const success = results.some(result => result.success);
    const firstMessage = results.find(result => result.result?.message_id || result.result?.id)?.result;
    const errors = results.filter(result => !result.success).map(result => `${result.platform}: ${result.error || result.result?.error}`);

    return {
      success,
      message_id: firstMessage?.message_id || firstMessage?.id,
      results,
      error: success ? undefined : errors.join('; ')
    };
  }

  async _sendTelegramQueueCompleted(data) {
    const { repoName, prNumber, prTitle, level, threadId, duration, reviewUrl } = data;
    const minutes = Math.round(duration / 60000);
    const urlPart = reviewUrl ? `\n🔗 ${reviewUrl}` : '';

    return this.telegramAdapter.sendToThread(
      threadId,
      `✅ <b>Review Completed</b>\n\n` +
      `📂 ${this._escapeHtml(`${data.instanceKey}/${repoName}`)} PR #${prNumber}\n` +
      `📝 ${this._escapeHtml(prTitle)}\n` +
      `🔍 Level: ${level.toUpperCase()}\n` +
      `⏱️ Duration: ~${minutes}m${urlPart}`
    );
  }

  async _sendTelegramQueueFailed(data) {
    const { repoName, prNumber, prTitle, level, threadId, error } = data;

    return this.telegramAdapter.sendToThread(
      threadId,
      `❌ <b>Review Failed</b>\n\n` +
      `📂 ${this._escapeHtml(`${data.instanceKey}/${repoName}`)} PR #${prNumber}\n` +
      `📝 ${this._escapeHtml(prTitle)}\n` +
      `🔍 Level: ${level.toUpperCase()}\n` +
      `⚠️ ${this._escapeHtml(error)}`
    );
  }

  _telegramEnabled() {
    return this.config.app?.telegram?.enabled === true;
  }

  _discordEnabled() {
    return this.config.app?.discord?.enabled === true;
  }

  _escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

module.exports = NotificationRouter;
