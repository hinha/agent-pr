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

      // Step 1a: Ensure headSha is available for review submission
      if (!pr.headSha) {
        try {
          const openPRs = await githubAdapter.getOpenPRs(repoName);
          const freshPR = openPRs.find(p => p.number === prNumber);
          if (freshPR?.headSha) {
            pr.headSha = freshPR.headSha;
          }
        } catch (err) {
          this.logger.warn(
            `[ReviewPRUseCase] Could not fetch headSha for PR #${prNumber}: ${err.message}`
          );
        }
      }

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

      return await this._finalizeReviewSubmission(
        instance,
        repo,
        pr,
        level,
        reviewResult,
        githubAdapter
      );

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

  async submitExternalResult(instance, repo, pr, level = 'medium', externalReviewResult, githubAdapter) {
    const prNumber = pr.number;

    try {
      this.logger.info(`[ReviewPRUseCase] Submitting external review result for PR #${prNumber}`);
      const normalizedReviewResult = this._normalizeExternalReviewResult(externalReviewResult);

      return await this._finalizeReviewSubmission(
        instance,
        repo,
        pr,
        level,
        normalizedReviewResult,
        githubAdapter
      );
    } catch (error) {
      this.logger.error(
        `[ReviewPRUseCase] Error submitting external review result for PR #${prNumber}:`,
        error
      );

      await this.eventBus.emitAsync('error.occurred', {
        useCase: 'ReviewPRUseCase.submitExternalResult',
        instanceKey: instance.key,
        repoName: repo.name,
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

  async _finalizeReviewSubmission(instance, repo, pr, level, reviewResult, githubAdapter) {
    const instanceKey = instance.key;
    const repoName = repo.name;
    const prNumber = pr.number;

    const review = await this._submitReview(
      repoName,
      pr,
      reviewResult,
      instance,
      githubAdapter
    );

    const newState = this._determineNewState(reviewResult);
    const currentState = await this.stateMachine.getState(instanceKey, repoName, prNumber);

    if (this.stateMachine.isTerminalState(currentState)) {
      this.logger.info(
        `[ReviewPRUseCase] PR #${prNumber} already in terminal state (${currentState}), skipping state transition`
      );
    } else if (currentState === newState) {
      this.logger.debug(
        `[ReviewPRUseCase] PR #${prNumber} already in state (${currentState}), skipping redundant transition`
      );
    } else {
      await this.stateMachine.transition(
        instanceKey,
        repoName,
        prNumber,
        newState,
        { reviewId: review.id, level }
      );
    }

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
  }

  _normalizeExternalReviewResult(externalReviewResult) {
    if (!externalReviewResult || typeof externalReviewResult !== 'object' || Array.isArray(externalReviewResult)) {
      throw new Error('External review result must be a JSON object');
    }

    const validationErrors = [];
    if (typeof externalReviewResult.summary !== 'string' || !externalReviewResult.summary.trim()) {
      validationErrors.push('field "summary" must be a non-empty string');
    }
    if (!Array.isArray(externalReviewResult.comments)) {
      validationErrors.push('field "comments" must be an array');
    }

    if (Array.isArray(externalReviewResult.comments)) {
      externalReviewResult.comments.forEach((comment, index) => {
        if (!comment || typeof comment !== 'object' || Array.isArray(comment)) {
          validationErrors.push(`comments[${index}] must be an object`);
          return;
        }

        const file = comment.file || comment.path || comment.filename;
        const line = comment.line || comment.start_line || comment.startLine;
        const endLine = comment.end_line || comment.endLine;
        const severity = String(comment.severity || '').trim().toUpperCase();

        if (!file || typeof file !== 'string') {
          validationErrors.push(`comments[${index}].file must be a non-empty string`);
        }

        if (!Number.isInteger(line) || line <= 0) {
          validationErrors.push(`comments[${index}].start_line must be a positive integer`);
        }

        if (endLine !== undefined && endLine !== null && (!Number.isInteger(endLine) || endLine < line)) {
          validationErrors.push(`comments[${index}].end_line must be an integer >= start_line`);
        }

        if (!['LOW', 'MEDIUM', 'HIGH'].includes(severity)) {
          validationErrors.push(`comments[${index}].severity must be one of LOW, MEDIUM, HIGH`);
        }

        if (!comment.message || typeof comment.message !== 'string' || !comment.message.trim()) {
          validationErrors.push(`comments[${index}].message must be a non-empty string`);
        }

        if (comment.suggestedCode !== undefined &&
          comment.suggestedCode !== null &&
          typeof comment.suggestedCode !== 'string' &&
          typeof comment.suggested_code !== 'string') {
          validationErrors.push(`comments[${index}].suggestedCode must be a string when present`);
        }
      });
    }

    if (validationErrors.length > 0) {
      throw new Error(`External review result validation failed: ${validationErrors.join('; ')}`);
    }

    const comments = Array.isArray(externalReviewResult.comments)
      ? externalReviewResult.comments.map(comment => ({
        file: comment.file || comment.path || comment.filename,
        line: comment.line || comment.start_line || comment.startLine,
        severity: comment.severity,
        message: comment.message,
        suggestedCode: comment.suggestedCode || comment.suggested_code
      }))
      : [];

    const requiresChanges = comments.some(comment => String(comment.severity || '').trim().toUpperCase() === 'HIGH');

    return {
      success: true,
      summary: typeof externalReviewResult.summary === 'string'
        ? externalReviewResult.summary
        : 'External review completed',
      comments,
      requiresChanges,
      agentCalledToolDirectly: false,
      agentRawOutput: JSON.stringify(externalReviewResult)
    };
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

      // Update state - skip if already in terminal state (e.g. processed)
      const currentState = await this.stateMachine.getState(instanceKey, repoName, prNumber);
      if (!this.stateMachine.isTerminalState(currentState)) {
        await this.stateMachine.transition(
          instanceKey,
          repoName,
          prNumber,
          PRState.APPROVED,
          { reviewId: review.id }
        );

        // Auto-mark as processed to prevent re-processing
        await this.stateMachine.markAsProcessed(
          instanceKey,
          repoName,
          prNumber,
          { reason: 'Approved via Telegram bot', reviewId: review.id }
        );

        this.logger.info(
          `[ReviewPRUseCase] PR #${prNumber} approved and marked as processed`
        );
      } else {
        this.logger.info(
          `[ReviewPRUseCase] PR #${prNumber} already in terminal state (${currentState}), skipping state transition`
        );
      }

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

      // Update state - skip if already in terminal state
      const currentState = await this.stateMachine.getState(instanceKey, repoName, prNumber);
      if (!this.stateMachine.isTerminalState(currentState)) {
        await this.stateMachine.transition(
          instanceKey,
          repoName,
          prNumber,
          PRState.CLOSED,
          {}
        );

        // Auto-mark as processed to prevent re-processing
        await this.stateMachine.markAsProcessed(
          instanceKey,
          repoName,
          prNumber,
          { reason: 'Closed via Telegram bot' }
        );

        this.logger.info(
          `[ReviewPRUseCase] PR #${prNumber} closed and marked as processed`
        );
      } else {
        this.logger.info(
          `[ReviewPRUseCase] PR #${prNumber} already in terminal state (${currentState}), skipping state transition`
        );
      }

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
