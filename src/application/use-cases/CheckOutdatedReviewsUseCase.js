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

      // Group outdated reviews by PR
      const prOutdatedMap = new Map(); // prNumber -> { pr, reviews: [] }

      // Check each PR for outdated reviews
      for (const pr of pullRequests) {
        const reviews = await githubAdapter.getPRReviews(repoName, pr.number);

        for (const review of reviews) {
          if (await this._isReviewOutdated(instance, repo, pr, review)) {
            if (!prOutdatedMap.has(pr.number)) {
              prOutdatedMap.set(pr.number, { pr, reviews: [] });
            }
            prOutdatedMap.get(pr.number).reviews.push(review);
          }
        }
      }

      // Send 1 consolidated notification per PR
      const notificationResults = [];
      const owner = instance.owner;

      for (const [prNumber, { pr, reviews }] of prOutdatedMap) {
        // Check if PR is currently silenced
        const isSkipped = await this.stateMachine.isSkipped(instanceKey, repoName, prNumber);
        if (isSkipped) {
          this.logger.debug(
            `[CheckOutdatedReviewsUseCase] Skipping outdated review for silenced PR #${prNumber}`
          );
          continue;
        }

        // Check if user dismissed notification for this exact headSha
        const fsRepo = this.stateMachine.stateRepository.getRepository(owner, repoName);
        const isDismissed = await fsRepo.isOutdatedNotified(
          owner, repoName, pr.id.toString(), pr.headSha
        );

        if (isDismissed) {
          this.logger.debug(
            `[CheckOutdatedReviewsUseCase] Skipping dismissed outdated review for PR #${prNumber} (headSha: ${pr.headSha?.substring(0, 7)})`
          );
          continue;
        }

        // Build consolidated notification data
        const reviewers = [...new Set(reviews.map(r => r.user).filter(Boolean))];
        const result = await this.notificationService.sendOutdatedReviewNotification(
          instance,
          repo,
          reviews[0], // primary review for backward compat
          pr,
          {
            outdatedCommit: reviews[0].headSha,
            currentCommit: pr.headSha,
            reviewCount: reviews.length,
            reviewers
          }
        );

        notificationResults.push({
          prNumber,
          reviewCount: reviews.length,
          sent: result.success
        });
      }

      // Emit summary event
      await this.eventBus.emitAsync('outdated_reviews.checked', {
        instanceKey,
        repoName,
        totalOutdated: [...prOutdatedMap.values()].reduce((sum, v) => sum + v.reviews.length, 0),
        notificationsSent: notificationResults.filter(r => r.sent).length
      });

      this.logger.info(
        `[CheckOutdatedReviewsUseCase] Found ${[...prOutdatedMap.values()].reduce((sum, v) => sum + v.reviews.length, 0)} outdated reviews across ${prOutdatedMap.size} PRs, ` +
        `sent ${notificationResults.filter(r => r.sent).length} notifications`
      );

      return {
        outdatedReviews: [...prOutdatedMap.values()].flatMap(({ pr, reviews }) =>
          reviews.map(review => ({ pr, review }))
        ),
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
    // 3. The PR is NOT in a terminal state (approved, rejected, closed, processed)

    if (review.state === 'DISMISSED') {
      return false;
    }

    if (review.headSha === pr.headSha) {
      return false;
    }

    // Check PR state - don't notify if PR is in a terminal state
    const prState = await this.stateMachine.getState(instance.key, repo.name, pr.number);
    const terminalStates = ['processed', 'closed', 'approved', 'rejected'];
    if (terminalStates.includes(prState)) {
      return false;
    }

    return true;
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
   * Dismiss an outdated review notification for a PR
   *
   * @param {Object} instance - Instance configuration
   * @param {Object} repo - Repository configuration
   * @param {string} reviewId - Review ID to dismiss (unused, kept for backward compat)
   * @param {string} prId - PR ID
   * @param {string} headSha - Current head SHA of the PR
   * @returns {Promise<Object>} Dismissal result
   */
  async dismissOutdatedReview(instance, repo, reviewId, prId = null, headSha = null) {
    try {
      if (prId && headSha && this.stateMachine?.stateRepository) {
        const owner = instance.owner;
        const fsRepo = this.stateMachine.stateRepository.getRepository(owner, repo.name);

        // Mark as dismissed for this headSha - notifications won't fire again
        // until new commits are pushed (headSha changes)
        await fsRepo.markOutdatedNotified(owner, repo.name, prId.toString(), headSha);

        this.logger.info(
          `[CheckOutdatedReviewsUseCase] Dismissed outdated review for PR #${prId} (headSha: ${headSha.substring(0, 7)})`
        );
      } else if (prId && this.stateMachine?.stateRepository) {
        // Fallback: clear dismiss data entirely (allows notifications on next cycle)
        const owner = instance.owner;
        const fsRepo = this.stateMachine.stateRepository.getRepository(owner, repo.name);
        await fsRepo.clearOutdatedNotified(owner, repo.name, prId.toString());

        this.logger.info(
          `[CheckOutdatedReviewsUseCase] Cleared outdated notification for PR #${prId} (no headSha provided)`
        );
      }

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
