/**
 * QueueNotificationSubscriber - Sends Telegram notifications for queue events
 *
 * Subscribes to queue.item.completed and queue.item.failed events
 * and sends status updates to the appropriate Telegram thread.
 *
 * @module infrastructure/telegram/QueueNotificationSubscriber
 */

class QueueNotificationSubscriber {
  /**
   * @param {Object} notificationRouter - NotificationRouter or TelegramBotAdapter instance
   * @param {Object} eventBus - EventBus instance
   * @param {Object} options - Configuration options
   */
  constructor(notificationRouter, eventBus, options = {}) {
    this.notificationRouter = notificationRouter;
    this.eventBus = eventBus;
    this.logger = options.logger || console;
  }

  /**
   * Subscribe to queue events
   */
  subscribe() {
    this.eventBus.on('queue.item.completed', (data) => this._onCompleted(data));
    this.eventBus.on('queue.item.failed', (data) => this._onFailed(data));
    this.logger.info('[QueueNotificationSubscriber] Subscribed to queue events');
  }

  /**
   * Handle completed event
   * @private
   * @param {Object} data - Event data
   */
  async _onCompleted(data) {
    try {
      if (this.notificationRouter.sendQueueCompletedNotification) {
        await this.notificationRouter.sendQueueCompletedNotification(data);
        return;
      }

      const { threadId } = data;
      await this.notificationRouter.sendToThread(threadId, this._buildCompletedMessage(data));
    } catch (error) {
      this.logger.error(`[QueueNotificationSubscriber] Failed to send completion notification: ${error.message}`);
    }
  }

  /**
   * Handle failed event
   * @private
   * @param {Object} data - Event data
   */
  async _onFailed(data) {
    try {
      if (this.notificationRouter.sendQueueFailedNotification) {
        await this.notificationRouter.sendQueueFailedNotification(data);
        return;
      }

      const { threadId } = data;
      await this.notificationRouter.sendToThread(threadId, this._buildFailedMessage(data));
    } catch (err) {
      this.logger.error(`[QueueNotificationSubscriber] Failed to send failure notification: ${err.message}`);
    }
  }

  _buildCompletedMessage(data) {
    const { repoName, prNumber, prTitle, level, duration, reviewUrl } = data;
    const minutes = Math.round(duration / 60000);
    const urlPart = reviewUrl ? `\n🔗 ${reviewUrl}` : '';

    return (
      `✅ <b>Review Completed</b>\n\n` +
      `📂 ${this._escapeHtml(`${data.instanceKey}/${repoName}`)} PR #${prNumber}\n` +
      `📝 ${this._escapeHtml(prTitle)}\n` +
      `🔍 Level: ${level.toUpperCase()}\n` +
      `⏱️ Duration: ~${minutes}m${urlPart}`
    );
  }

  _buildFailedMessage(data) {
    const { repoName, prNumber, prTitle, level, error } = data;

    return (
      `❌ <b>Review Failed</b>\n\n` +
      `📂 ${this._escapeHtml(`${data.instanceKey}/${repoName}`)} PR #${prNumber}\n` +
      `📝 ${this._escapeHtml(prTitle)}\n` +
      `🔍 Level: ${level.toUpperCase()}\n` +
      `⚠️ ${this._escapeHtml(error)}`
    );
  }

  /**
   * Escape HTML special characters
   * @private
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  _escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}

module.exports = QueueNotificationSubscriber;
