/**
 * CheckOutdatedReviewsUseCase - Application use case for checking outdated reviews
 *
 * This use case detects reviews that have been invalidated by new commits
 * and sends notifications to alert reviewers.
 *
 * @example
 * const useCase = new CheckOutdatedReviewsUseCase(githubService, notificationService, stateMachine, eventBus);
 * const outdated = await useCase.execute(instance, repo, pullRequests);
 */


class CheckOutdatedReviewsUseCase {
  /**
   * @param {Object} notificationService - SendNotificationUseCase instance
   * @param {Object} stateMachine - PRStateMachine instance
   * @param {Object} eventBus - EventBus instance
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   */
  constructor(notificationService, stateMachine, eventBus, options = {}) {
    this.notificationService = notificationService;
    this.stateMachine = stateMachine;
    this.eventBus = eventBus;
    this.logger = options.logger || console;
  }

  /**
   * Execute the outdated reviews check use case
   *
   * @param {Object} instance - Instance configuration
   * @param {Object} repo - Repository configuration
   * @param {Array} pullRequests - Array of PullRequest entities
   * @param {Object} githubAdapter - MCPGitHubAdapter instance for the instance
   * @returns {Promise<Object>} Check result with outdated reviews
   */
  async execute(instance, repo, pullRequests, githubAdapter) {
    const instanceKey = instance.key;
    const repoName = repo.name;

    try {
      this.logger.debug(
        `[CheckOutdatedReviewsUseCase] Checking for outdated reviews in ${repoName}`
      );

      const outdatedReviews = [];

      // Check each PR for outdated reviews
      for (const pr of pullRequests) {
        const reviews = await githubAdapter.getPRReviews(repoName, pr.number);

        for (const review of reviews) {
          if (await this._isReviewOutdated(instance, repo, pr, review)) {
            outdatedReviews.push({
              pr,
              review,
              outdatedCommit: review.headSha,
              currentCommit: pr.headSha
            });
          }
        }
      }

      // Send notifications for outdated reviews
      const notificationResults = [];
      for (const { pr, review, outdatedCommit, currentCommit } of outdatedReviews) {
        // Check if we already notified about this outdated review
        const notificationKey = `${instanceKey}/${repoName}/outdated/${review.id}`;
        const alreadyNotified = await this._wasAlreadyNotified(notificationKey);

        if (!alreadyNotified) {
          const result = await this.notificationService.sendOutdatedReviewNotification(
            instance,
            repo,
            review,
            pr,
            { outdatedCommit, currentCommit }
          );

          notificationResults.push({
            reviewId: review.id,
            prNumber: pr.number,
            sent: result.success
          });

          // Mark as notified
          await this._markAsNotified(notificationKey);
        }
      }

      // Emit summary event
      await this.eventBus.emitAsync('outdated_reviews.checked', {
        instanceKey,
        repoName,
        totalOutdated: outdatedReviews.length,
        notificationsSent: notificationResults.filter(r => r.sent).length
      });

      this.logger.info(
        `[CheckOutdatedReviewsUseCase] Found ${outdatedReviews.length} outdated reviews, ` +
        `sent ${notificationResults.filter(r => r.sent).length} notifications`
      );

      return {
        outdatedReviews,
        notificationResults
      };

    } catch (error) {
      this.logger.error(
        `[CheckOutdatedReviewsUseCase] Error checking outdated reviews in ${repoName}:`,
        error
      );

      await this.eventBus.emitAsync('error.occurred', {
        useCase: 'CheckOutdatedReviewsUseCase',
        instanceKey,
        repoName,
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Check if a review is outdated
   * @private
   */
  async _isReviewOutdated(instance, repo, pr, review) {
    // Review is outdated if:
    // 1. It's not dismissed
    // 2. The head SHA has changed
    // 3. The review is not in a terminal state

    if (review.state === 'DISMISSED') {
      return false;
    }

    if (review.headSha === pr.headSha) {
      return false;
    }

    // Check PR state - don't notify if PR is already processed
    const prState = await this.stateMachine.getState(instance.key, repo.name, pr.number);
    if (prState === 'processed' || prState === 'closed') {
      return false;
    }

    return true;
  }

  /**
   * Check if we already sent a notification for this outdated review
   * @private
   */
  async _wasAlreadyNotified(key) {
    // This would use the state repository to check
    // For now, we'll use a simple in-memory approach
    // In production, this should persist to avoid duplicate notifications
    return this._outdatedNotifications?.has(key) || false;
  }

  /**
   * Mark that we sent a notification for this outdated review
   * @private
   */
  async _markAsNotified(key) {
    if (!this._outdatedNotifications) {
      this._outdatedNotifications = new Set();
    }
    this._outdatedNotifications.add(key);

    // Set expiry for the notification record (e.g., 24 hours)
    setTimeout(() => {
      this._outdatedNotifications.delete(key);
    }, 24 * 60 * 60 * 1000);
  }

  /**
   * Check if a specific review is outdated
   *
   * @param {Object} instance - Instance configuration
   * @param {Object} repo - Repository configuration
   * @param {Object} pr - PullRequest entity
   * @param {Object} review - Review entity
   * @returns {Promise<boolean>} True if review is outdated
   */
  async isReviewOutdated(instance, repo, pr, review) {
    return this._isReviewOutdated(instance, repo, pr, review);
  }

  /**
   * Dismiss an outdated review notification
   *
   * @param {Object} instance - Instance configuration
   * @param {Object} repo - Repository configuration
   * @param {string} reviewId - Review ID to dismiss
   * @returns {Promise<Object>} Dismissal result
   */
  async dismissOutdatedReview(instance, repo, reviewId) {
    const notificationKey = `${instance.key}/${repo.name}/outdated/${reviewId}`;

    try {
      // Remove from notification tracking
      if (this._outdatedNotifications) {
        this._outdatedNotifications.delete(notificationKey);
      }

      this.logger.debug(
        `[CheckOutdatedReviewsUseCase] Dismissed outdated review notification for ${reviewId}`
      );

      return { success: true };

    } catch (error) {
      this.logger.error(
        `[CheckOutdatedReviewsUseCase] Error dismissing outdated review ${reviewId}:`,
        error
      );

      return { success: false, error: error.message };
    }
  }
}

module.exports = CheckOutdatedReviewsUseCase;
