/**
 * SendNotificationUseCase - Application use case for sending notifications
 *
 * This use case handles sending notifications via Telegram with proper
 * formatting, inline buttons, and error handling.
 *
 * @example
 * const useCase = new SendNotificationUseCase(telegramService, stateMachine, eventBus);
 * await useCase.execute(instance, repo, pr, analysis);
 */


class SendNotificationUseCase {
  /**
   * @param {Object} telegramService - TelegramService instance
   * @param {Object} stateMachine - PRStateMachine instance
   * @param {Object} eventBus - EventBus instance
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   */
  constructor(telegramService, stateMachine, eventBus, options = {}) {
    this.telegramService = telegramService;
    this.stateMachine = stateMachine;
    this.eventBus = eventBus;
    this.logger = options.logger || console;
  }

  /**
   * Execute the notification use case
   *
   * @param {Object} instance - Instance configuration
   * @param {Object} repo - Repository configuration
   * @param {Object} pr - PullRequest entity
   * @param {Object} analysis - PR analysis result
   * @returns {Promise<Object>} Notification result
   */
  async execute(instance, repo, pr, analysis) {
    const instanceKey = instance.key;
    const repoName = repo.name;
    const prNumber = pr.number;

    try {
      this.logger.debug(
        `[SendNotificationUseCase] Sending notification for PR #${prNumber}`
      );

      // Format notification message
      const message = this._formatNotificationMessage(pr, analysis);

      // Build inline keyboard buttons
      const keyboard = this._buildKeyboard(instance, repo, pr, analysis);

      // Get notification count
      const notificationCount = await this.stateMachine.getNotificationCount(
        instanceKey,
        repoName,
        prNumber
      );

      // Send notification
      const result = await this.telegramService.sendMessage(
        repo.threadId,
        message,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );

      // Emit success event
      await this.eventBus.emitAsync('notification.sent', {
        instanceKey,
        repoName,
        prNumber,
        notificationCount,
        messageId: result.message_id
      });

      this.logger.info(
        `[SendNotificationUseCase] Notification sent for PR #${prNumber} ` +
        `(count: ${notificationCount}, message_id: ${result.message_id})`
      );

      return {
        success: true,
        messageId: result.message_id,
        notificationCount
      };

    } catch (error) {
      this.logger.error(
        `[SendNotificationUseCase] Error sending notification for PR #${prNumber}:`,
        error
      );

      // Emit error event
      await this.eventBus.emitAsync('notification.failed', {
        instanceKey,
        repoName,
        prNumber,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Format notification message
   * @private
   */
  _formatNotificationMessage(pr, analysis) {
    const { title, author, url, number } = pr;
    const { riskLevel, impactArea, recommendedReview, suspiciousPatterns } = analysis;

    // Build header with PR info
    let message = `<b>🔔 PR Review Required</b>\n\n`;
    message += `<b>${title}</b>\n`;
    message += `<a href="${url}">#${number}</a> by ${author}\n`;

    // Add analysis info
    message += `\n<b>Risk:</b> ${riskLevel.toUpperCase()}\n`;
    message += `<b>Impact:</b> ${impactArea}\n`;
    message += `<b>Recommendation:</b> ${recommendedReview}\n`;

    // Add suspicious patterns if any
    if (suspiciousPatterns.length > 0) {
      message += `\n<b>⚠️ Patterns:</b>\n`;
      suspiciousPatterns.forEach(pattern => {
        message += `• ${this._formatPattern(pattern)}\n`;
      });
    }

    return message;
  }

  /**
   * Format suspicious pattern for display
   * @private
   */
  _formatPattern(pattern) {
    const patternLabels = {
      database_migration: '🗄️ Database Migration',
      security_changes: '🔒 Security Changes',
      large_file_changes: '📦 Large File Changes',
      test_coverage_reduced: '📉 Test Coverage Reduced',
      config_changes: '⚙️ Config Changes',
      dependency_update: '📦 Dependency Update',
      build_system_changes: '🔧 Build System Changes',
      api_contract_changes: '📄 API Contract Changes',
      infrastructure_changes: '🌐 Infrastructure Changes',
      architecture_violation: '🏗️ Architecture Violation'
    };

    return patternLabels[pattern] || pattern.replace(/_/g, ' ');
  }

  /**
   * Build inline keyboard with actions
   * @private
   */
  _buildKeyboard(instance, repo, pr, analysis) {
    const { instanceIdx, repoIdx } = instance;
    const prId = pr.id;

    const keyboard = [];

    // First row: Review Now and Skip
    keyboard.push([
      { text: '🔍 Review Now', callback_data: `action:${instanceIdx}:${repoIdx}:${prId}` },
      { text: '⏭️ Skip 3h', callback_data: `skip:${instanceIdx}:${repoIdx}:${prId}` }
    ]);

    // Second row: Approve and Reject
    keyboard.push([
      { text: '✅ Approve', callback_data: `approve:${instanceIdx}:${repoIdx}:${prId}` },
      { text: '❌ Reject', callback_data: `reject:${instanceIdx}:${repoIdx}:${prId}` }
    ]);

    // Third row: Review levels
    keyboard.push([
      { text: '🟢 Low', callback_data: `review_level:${instanceIdx}:${repoIdx}:${prId}:low` },
      { text: '🟡 Medium', callback_data: `review_level:${instanceIdx}:${repoIdx}:${prId}:medium` },
      { text: '🔴 High', callback_data: `review_level:${instanceIdx}:${repoIdx}:${prId}:high` }
    ]);

    return keyboard;
  }

  /**
   * Send outdated review notification
   *
   * @param {Object} instance - Instance configuration
   * @param {Object} repo - Repository configuration
   * @param {Object} review - Review entity
   * @param {Object} pr - Current PR state
   * @returns {Promise<Object>} Notification result
   */
  async sendOutdatedReviewNotification(instance, repo, review, pr) {
    const instanceKey = instance.key;
    const repoName = repo.name;

    try {
      this.logger.debug(
        `[SendNotificationUseCase] Sending outdated review notification for review ${review.id}`
      );

      const message = this._formatOutdatedReviewMessage(review, pr);
      const keyboard = this._buildOutdatedReviewKeyboard(instance, repo, review, pr);

      const result = await this.telegramService.sendMessage(
        repo.threadId,
        message,
        {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
          reply_markup: {
            inline_keyboard: keyboard
          }
        }
      );

      // Emit event
      await this.eventBus.emitAsync('review.outdated', {
        instanceKey,
        repoName,
        reviewId: review.id,
        prNumber: pr.number,
        messageId: result.message_id
      });

      return {
        success: true,
        messageId: result.message_id
      };

    } catch (error) {
      this.logger.error(
        `[SendNotificationUseCase] Error sending outdated review notification:`,
        error
      );

      await this.eventBus.emitAsync('notification.failed', {
        instanceKey,
        repoName,
        reviewId: review.id,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Format outdated review notification message
   * @private
   */
  _formatOutdatedReviewMessage(review, pr) {
    let message = `<b>⚠️ Review Outdated</b>\n\n`;
    message += `Review for <a href="${pr.url}">#${pr.number}</a> is outdated.\n`;
    message += `New commits have been pushed since the review.\n\n`;
    message += `<b>Review:</b> ${review.state}\n`;
    const commentCount = typeof review.getCommentsCount === 'function' ? review.getCommentsCount() : (review.comments?.length || 0);
    message += `<b>Comments:</b> ${commentCount}\n`;

    return message;
  }

  /**
   * Build keyboard for outdated review notification
   * @private
   */
  _buildOutdatedReviewKeyboard(instance, repo, review, pr) {
    const { instanceIdx, repoIdx } = instance;
    const prId = pr.id;

    return [
      [
        { text: '🔄 Re-review', callback_data: `action:${instanceIdx}:${repoIdx}:${prId}` },
        { text: '✅ Dismiss', callback_data: `dismiss:${instanceIdx}:${repoIdx}:${review.id}` }
      ]
    ];
  }
}

module.exports = SendNotificationUseCase;
