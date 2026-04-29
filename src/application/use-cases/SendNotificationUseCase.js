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

      // Get notification count
      const notificationCount = await this.stateMachine.getNotificationCount(
        instanceKey,
        repoName,
        prNumber
      );

      // Send notification using adapter's high-level method
      const result = await this.telegramService.sendPRNotification({
        owner: instance.owner,
        repo: repoName,
        pr,
        summary: {
          purpose: analysis.purpose,
          riskLevel: analysis.riskLevel,
          impactArea: analysis.impactArea,
          diffSize: analysis.diffSize,
          suspiciousPatterns: analysis.suspiciousPatterns
        },
        threadId: repo.threadId
      });

      // Emit success event
      await this.eventBus.emitAsync('notification.sent', {
        instanceKey,
        repoName,
        prNumber,
        notificationCount,
        messageId: result?.message_id
      });

      this.logger.info(
        `[SendNotificationUseCase] Notification sent for PR #${prNumber} ` +
        `(count: ${notificationCount})`
      );

      return {
        success: true,
        messageId: result?.message_id,
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

      // Send notification using adapter's high-level method
      const result = await this.telegramService.sendOutdatedReviewNotification({
        owner: instance.owner,
        repo: repoName,
        pr,
        reviewState: review.state,
        threadId: repo.threadId
      });

      // Emit event
      await this.eventBus.emitAsync('review.outdated', {
        instanceKey,
        repoName,
        reviewId: review.id,
        prNumber: pr.number,
        messageId: result?.message_id
      });

      return {
        success: true,
        messageId: result?.message_id
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
}

module.exports = SendNotificationUseCase;
