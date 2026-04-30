/**
 * ReviewPRUseCase - Application use case for reviewing a Pull Request with AI
 *
 * This use case orchestrates the AI review workflow:
 * 1. Fetch PR details and changed files
 * 2. Run AI analysis on the changes
 * 3. Parse and format review comments
 * 4. Submit review via GitHub API
 * 5. Update state machine
 *
 * @example
 * const useCase = new ReviewPRUseCase(agentService, stateMachine, eventBus);
 * await useCase.execute(instance, repo, pr, level, githubAdapter);
 */

const PRStateMachine = require('../../core/services/PRStateMachine');
const { PRState } = PRStateMachine;

class ReviewPRUseCase {
  /**
   * @param {Object} agentService - AgentService instance for AI review
   * @param {Object} stateMachine - PRStateMachine instance
   * @param {Object} eventBus - EventBus instance
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   */
  constructor(agentService, stateMachine, eventBus, options = {}) {
    this.agentService = agentService;
    this.stateMachine = stateMachine;
    this.eventBus = eventBus;
    this.logger = options.logger || console;
  }

  /**
   * Execute the PR review use case
   *
   * @param {Object} instance - Instance configuration
   * @param {Object} repo - Repository configuration
   * @param {Object} pr - PullRequest entity
   * @param {string} level - Review level (low, medium, high)
   * @param {Object} githubAdapter - MCPGitHubAdapter instance for the instance
   * @returns {Promise<Object>} Review result
   */
  async execute(instance, repo, pr, level = 'medium', githubAdapter) {
    const instanceKey = instance.key;
    const repoName = repo.name;
    const prNumber = pr.number;

    try {
      this.logger.info(
        `[ReviewPRUseCase] Starting ${level} review for PR #${prNumber}`
      );

      // Step 1: Fetch PR details
      const prDetails = await githubAdapter.getPRDetails(repoName, prNumber);
      const { files, totalChanges } = prDetails;

      this.logger.debug(
        `[ReviewPRUseCase] PR #${prNumber} has ${files.length} files, ${totalChanges} changes`
      );

      // Step 1b: Fetch previous review comments to avoid duplication
      let previousComments = [];
      try {
        previousComments = await githubAdapter.getPRComments(repoName, prNumber);
        this.logger.info(
          `[ReviewPRUseCase] Found ${previousComments.length} previous comments on PR #${prNumber}`
        );
      } catch (err) {
        this.logger.warn(
          `[ReviewPRUseCase] Could not fetch previous comments for PR #${prNumber}: ${err.message}`
        );
      }

      // Step 1c: Fetch recent commits to understand what developer fixed
      let lastCommits = [];
      try {
        lastCommits = await githubAdapter.getPRCommits(repoName, prNumber, 3);
        this.logger.info(
          `[ReviewPRUseCase] Found ${lastCommits.length} recent commits on PR #${prNumber}`
        );
      } catch (err) {
        this.logger.warn(
          `[ReviewPRUseCase] Could not fetch commits for PR #${prNumber}: ${err.message}`
        );
      }

      // Step 2: Run AI analysis
      const reviewResult = await this.agentService.reviewPR(
        instance.owner,
        repoName,
        pr,
        files,
        level,
        previousComments,
        lastCommits
      );

      if (!reviewResult.success) {
        throw new Error(`AI review failed: ${reviewResult.error}`);
      }

      this.logger.debug(
        `[ReviewPRUseCase] AI review completed for PR #${prNumber}: ` +
        `${reviewResult.comments.length} comments`
      );

      // Step 3: Submit review via GitHub
      const review = await this._submitReview(
        repoName,
        pr,
        reviewResult,
        instance,
        githubAdapter
      );

      // Step 4: Update state machine based on review result
      const newState = this._determineNewState(reviewResult);
      await this.stateMachine.transition(
        instanceKey,
        repoName,
        prNumber,
        newState,
        { reviewId: review.id, level }
      );

      // Step 5: Emit domain event
      await this.eventBus.emitAsync('review.created', {
        instanceKey,
        repoName,
        prNumber,
        reviewId: review.id,
        state: review.state,
        commentCount: reviewResult.comments.length
      });

      this.logger.info(
        `[ReviewPRUseCase] Review submitted for PR #${prNumber} ` +
        `(state: ${review.state}, comments: ${reviewResult.comments.length})`
      );

      return {
        success: true,
        review,
        reviewResult,
        state: newState
      };

    } catch (error) {
      this.logger.error(
        `[ReviewPRUseCase] Error reviewing PR #${prNumber}:`,
        error
      );

      // Emit error event
      await this.eventBus.emitAsync('error.occurred', {
        useCase: 'ReviewPRUseCase',
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
   * Submit review to GitHub
   * Pass reviewResult directly to createReviewWithComments which handles
   * event determination, comment validation/formatting, and position mapping.
   * @private
   */
  async _submitReview(repoName, pr, reviewResult, instance, githubAdapter) {
    // Pass reviewResult directly — createReviewWithComments handles:
    // - Event determination based on severity (COMMENT / REQUEST_CHANGES)
    // - Comment validation and sanitization
    // - Position calculation from diff patches
    // - Fallback for own-PR reviews
    const review = await githubAdapter.createReviewWithComments(
      repoName,
      pr,
      reviewResult
    );

    return review;
  }

  /**
   * Determine new state based on review result
   * @private
   */
  _determineNewState(reviewResult) {
    if (reviewResult.requiresChanges) {
      return PRState.REJECTED;
    }
    return PRState.APPROVED;
  }

  /**
   * Approve a PR without full review
   *
   * @param {Object} instance - Instance configuration
   * @param {Object} repo - Repository configuration
   * @param {Object} pr - PullRequest entity
   * @param {Object} githubAdapter - MCPGitHubAdapter instance for the instance
   * @returns {Promise<Object>} Approval result
   */
  async approve(instance, repo, pr, githubAdapter) {
    const instanceKey = instance.key;
    const repoName = repo.name;
    const prNumber = pr.number;

    try {
      this.logger.info(`[ReviewPRUseCase] Approving PR #${prNumber}`);

      const review = await githubAdapter.approvePR(
        repoName,
        prNumber,
        'Approved via Telegram bot'
      );

      // Update state
      await this.stateMachine.transition(
        instanceKey,
        repoName,
        prNumber,
        PRState.APPROVED,
        { reviewId: review.id }
      );

      // Emit event
      await this.eventBus.emitAsync('pr.approved', {
        instanceKey,
        repoName,
        prNumber,
        reviewId: review.id
      });

      return { success: true, review };

    } catch (error) {
      this.logger.error(`[ReviewPRUseCase] Error approving PR #${prNumber}:`, error);

      await this.eventBus.emitAsync('error.occurred', {
        useCase: 'ReviewPRUseCase.approve',
        instanceKey,
        repoName,
        prNumber,
        error: error.message
      });

      return { success: false, error: error.message };
    }
  }

  /**
   * Request changes on a PR
   *
   * @param {Object} instance - Instance configuration
   * @param {Object} repo - Repository configuration
   * @param {Object} pr - PullRequest entity
   * @param {string} reason - Reason for rejection
   * @param {Object} githubAdapter - MCPGitHubAdapter instance for the instance
   * @returns {Promise<Object>} Rejection result
   */
  async reject(instance, repo, pr, reason = 'Changes requested via Telegram bot', githubAdapter) {
    const instanceKey = instance.key;
    const repoName = repo.name;
    const prNumber = pr.number;

    try {
      this.logger.info(`[ReviewPRUseCase] Requesting changes for PR #${prNumber}`);

      const review = await githubAdapter.createReviewWithComments(
        repoName,
        pr,
        {
          body: reason,
          comments: [],
          event: 'request_changes'
        }
      );

      // Update state
      await this.stateMachine.transition(
        instanceKey,
        repoName,
        prNumber,
        PRState.REJECTED,
        { reviewId: review.id }
      );

      // Emit event
      await this.eventBus.emitAsync('pr.rejected', {
        instanceKey,
        repoName,
        prNumber,
        reviewId: review.id
      });

      return { success: true, review };

    } catch (error) {
      this.logger.error(`[ReviewPRUseCase] Error rejecting PR #${prNumber}:`, error);

      await this.eventBus.emitAsync('error.occurred', {
        useCase: 'ReviewPRUseCase.reject',
        instanceKey,
        repoName,
        prNumber,
        error: error.message
      });

      return { success: false, error: error.message };
    }
  }

  /**
   * Close a PR
   *
   * @param {Object} instance - Instance configuration
   * @param {Object} repo - Repository configuration
   * @param {Object} pr - PullRequest entity
   * @param {Object} githubAdapter - MCPGitHubAdapter instance for the instance
   * @returns {Promise<Object>} Close result
   */
  async close(instance, repo, pr, githubAdapter) {
    const instanceKey = instance.key;
    const repoName = repo.name;
    const prNumber = pr.number;

    try {
      this.logger.info(`[ReviewPRUseCase] Closing PR #${prNumber}`);

      await githubAdapter.closePR(repoName, prNumber);

      // Update state
      await this.stateMachine.transition(
        instanceKey,
        repoName,
        prNumber,
        PRState.CLOSED,
        {}
      );

      // Emit event
      await this.eventBus.emitAsync('pr.closed', {
        instanceKey,
        repoName,
        prNumber
      });

      return { success: true };

    } catch (error) {
      this.logger.error(`[ReviewPRUseCase] Error closing PR #${prNumber}:`, error);

      await this.eventBus.emitAsync('error.occurred', {
        useCase: 'ReviewPRUseCase.close',
        instanceKey,
        repoName,
        prNumber,
        error: error.message
      });

      return { success: false, error: error.message };
    }
  }

  /**
   * Skip notifications for a PR temporarily
   *
   * @param {Object} instance - Instance configuration
   * @param {Object} repo - Repository configuration
   * @param {Object} pr - PullRequest entity
   * @param {number} duration - Skip duration in milliseconds (default: 3 hours)
   * @returns {Promise<Object>} Skip result
   */
  async skip(instance, repo, pr, duration = 3 * 60 * 60 * 1000) {
    const instanceKey = instance.key;
    const repoName = repo.name;
    const prNumber = pr.number;

    try {
      this.logger.info(`[ReviewPRUseCase] Skipping PR #${prNumber} for ${duration}ms`);

      await this.stateMachine.markAsSkipped(instanceKey, repoName, prNumber, duration);

      this.logger.info(`[ReviewPRUseCase] PR #${prNumber} skipped until ${new Date(Date.now() + duration).toISOString()}`);

      return { success: true, duration };

    } catch (error) {
      this.logger.error(`[ReviewPRUseCase] Error skipping PR #${prNumber}:`, error);

      return { success: false, error: error.message };
    }
  }
}

module.exports = ReviewPRUseCase;
