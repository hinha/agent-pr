/**
 * CallbackHandler - Handles Telegram bot callback queries
 *
 * This handler processes inline button callbacks from Telegram,
 * such as approve, reject, review now, skip, etc.
 *
 * @example
 * const handler = new CallbackHandler(reviewPRUseCase, stateMachine, eventBus);
 * await handler.handleCallbackQuery(query);
 */

class CallbackHandler {
  /**
   * @param {Object} reviewPRUseCase - ReviewPRUseCase instance
   * @param {Object} stateMachine - PRStateMachine instance
   * @param {Object} eventBus - EventBus instance
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   */
  constructor(reviewPRUseCase, stateMachine, eventBus, options = {}) {
    this.reviewPRUseCase = reviewPRUseCase;
    this.stateMachine = stateMachine;
    this.eventBus = eventBus;
    this.logger = options.logger || console;
  }

  /**
   * Handle a callback query from Telegram
   *
   * @param {Object} query - Telegram callback query object
   * @param {Object} config - Full configuration with instances
   * @returns {Promise<Object>} Handler result
   */
  async handleCallbackQuery(query, config) {
    const { data } = query;

    try {
      this.logger.debug(`[CallbackHandler] Processing callback: ${data}`);

      // Parse callback data
      const callback = this._parseCallbackData(data);

      if (!callback) {
        throw new Error(`Invalid callback data format: ${data}`);
      }

      // Get instance and repo configuration
      const instance = this._getInstance(config, callback.instanceIdx);
      const repo = this._getRepo(instance, callback.repoIdx);

      // Build PR entity from callback data
      const pr = this._buildPREntity(callback, repo);

      let result;

      // Handle different callback actions
      switch (callback.action) {
        case 'action':
          // Show review level selection
          result = await this._handleReviewLevelSelection(query, instance, repo, pr);
          break;

        case 'approve':
          result = await this._handleApprove(query, instance, repo, pr);
          break;

        case 'reject':
          result = await this._handleReject(query, instance, repo, pr);
          break;

        case 'close':
          result = await this._handleClose(query, instance, repo, pr);
          break;

        case 'skip':
          result = await this._handleSkip(query, instance, repo, pr);
          break;

        case 'review_level':
          result = await this._handleReviewLevel(query, instance, repo, pr, callback.level);
          break;

        case 'dismiss':
          result = await this._handleDismissOutdated(query, instance, repo, callback.reviewId);
          break;

        default:
          throw new Error(`Unknown callback action: ${callback.action}`);
      }

      // Emit callback handled event
      await this.eventBus.emitAsync('callback.handled', {
        action: callback.action,
        instanceKey: instance.key,
        repoName: repo.name,
        prNumber: pr.number,
        result
      });

      return result;

    } catch (error) {
      this.logger.error(`[CallbackHandler] Error handling callback ${data}:`, error);

      await this.eventBus.emitAsync('callback.error', {
        useCase: 'CallbackHandler',
        callbackData: data,
        error: error.message
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Parse callback data string into components
   * @private
   */
  _parseCallbackData(data) {
    // Standard format: action:instanceIdx:repoIdx:prId
    // Review level format: review_level:instanceIdx:repoIdx:prId:level
    const parts = data.split(':');

    if (parts.length < 4) {
      return null;
    }

    const callback = {
      action: parts[0],
      instanceIdx: parseInt(parts[1], 10),
      repoIdx: parseInt(parts[2], 10),
      prId: parts[3]
    };

    if (callback.action === 'review_level' && parts.length >= 5) {
      callback.level = parts[4];
    }

    if (callback.action === 'dismiss' && parts.length >= 5) {
      callback.reviewId = parts[4];
    }

    return callback;
  }

  /**
   * Get instance configuration by index
   * @private
   */
  _getInstance(config, instanceIdx) {
    const instances = Object.values(config.instances);
    const instance = instances[instanceIdx];

    if (!instance) {
      throw new Error(`Instance not found at index ${instanceIdx}`);
    }

    return {
      ...instance,
      instanceIdx
    };
  }

  /**
   * Get repository configuration by index
   * @private
   */
  _getRepo(instance, repoIdx) {
    const repos = Object.values(instance.repos || {});
    const repo = repos[repoIdx];

    if (!repo) {
      throw new Error(`Repository not found at index ${repoIdx}`);
    }

    return {
      name: repo.name || Object.keys(instance.repos)[repoIdx],
      threadId: repo.thread_id,
      instanceKey: instance.key,
      repoIdx
    };
  }

  /**
   * Build PR entity from callback data
   * @private
   */
  _buildPREntity(callback, repo) {
    const PullRequest = require('../../core/entities/PullRequest');

    return new PullRequest({
      id: callback.prId,
      number: parseInt(callback.prId.split('-')[1] || callback.prId, 10),
      title: 'PR from callback',
      owner: repo.instanceKey.split('/')[1],
      repo: repo.name,
      url: `https://github.com/${repo.instanceKey.split('/')[1]}/${repo.name}/pull/${callback.prId}`,
      createdAt: new Date()
    });
  }

  /**
   * Handle review level selection - show available levels
   * @private
   */
  async _handleReviewLevelSelection(query, instance, repo, pr) {
    this.logger.info(
      `[CallbackHandler] Review level requested for PR #${pr.number}`
    );

    // Answer callback to show processing
    await query.answer('Select review level...');

    // Edit message to show level options
    // This would be handled by TelegramAdapter
    return {
      success: true,
      action: 'show_levels'
    };
  }

  /**
   * Handle approve action
   * @private
   */
  async _handleApprove(query, instance, repo, pr) {
    this.logger.info(`[CallbackHandler] Approving PR #${pr.number}`);

    await query.answer('Approving PR...');

    const result = await this.reviewPRUseCase.approve(instance, repo, pr);

    if (result.success) {
      await query.editMessageText(`✅ PR #${pr.number} approved`);
    } else {
      await query.answer(`Failed to approve: ${result.error}`, true);
    }

    return result;
  }

  /**
   * Handle reject action
   * @private
   */
  async _handleReject(query, instance, repo, pr) {
    this.logger.info(`[CallbackHandler] Rejecting PR #${pr.number}`);

    await query.answer('Requesting changes...');

    const result = await this.reviewPRUseCase.reject(instance, repo, pr);

    if (result.success) {
      await query.editMessageText(`❌ Changes requested for PR #${pr.number}`);
    } else {
      await query.answer(`Failed to reject: ${result.error}`, true);
    }

    return result;
  }

  /**
   * Handle close action
   * @private
   */
  async _handleClose(query, instance, repo, pr) {
    this.logger.info(`[CallbackHandler] Closing PR #${pr.number}`);

    await query.answer('Closing PR...');

    const result = await this.reviewPRUseCase.close(instance, repo, pr);

    if (result.success) {
      await query.editMessageText(`🔒 PR #${pr.number} closed`);
    } else {
      await query.answer(`Failed to close: ${result.error}`, true);
    }

    return result;
  }

  /**
   * Handle skip action
   * @private
   */
  async _handleSkip(query, instance, repo, pr) {
    this.logger.info(`[CallbackHandler] Skipping notifications for PR #${pr.number}`);

    await query.answer('Skipping...');

    const skipDuration = 3 * 60 * 60 * 1000; // 3 hours
    const result = await this.reviewPRUseCase.skip(instance, repo, pr, skipDuration);

    if (result.success) {
      const skipUntil = new Date(Date.now() + skipDuration).toLocaleTimeString();
      await query.editMessageText(`⏭️ Notifications skipped until ${skipUntil}`);
    } else {
      await query.answer(`Failed to skip: ${result.error}`, true);
    }

    return result;
  }

  /**
   * Handle review level selection
   * @private
   */
  async _handleReviewLevel(query, instance, repo, pr, level) {
    this.logger.info(
      `[CallbackHandler] Starting ${level} review for PR #${pr.number}`
    );

    await query.answer(`Running ${level} review...`);

    const result = await this.reviewPRUseCase.execute(instance, repo, pr, level);

    if (result.success) {
      await query.editMessageText(
        `🔍 ${level.toUpperCase()} review completed\n` +
        `${result.reviewResult.comments.length} comments added`
      );
    } else {
      await query.editMessageText(`❌ Review failed: ${result.error}`);
    }

    return result;
  }

  /**
   * Handle dismiss outdated review notification
   * @private
   */
  async _handleDismissOutdated(query, instance, repo, reviewId) {
    this.logger.info(`[CallbackHandler] Dismissing outdated review ${reviewId}`);

    await query.answer('Dismissing...');

    // Use CheckOutdatedReviewsUseCase to dismiss
    const checkOutdatedReviews = this.reviewPRUseCase.constructor.name === 'ReviewPRUseCase'
      ? null // Will need to get from container
      : this.reviewPRUseCase;

    if (checkOutdatedReviews && typeof checkOutdatedReviews.dismissOutdatedReview === 'function') {
      const result = await checkOutdatedReviews.dismissOutdatedReview(
        instance,
        repo,
        reviewId
      );

      if (result.success) {
        await query.editMessageText('✅ Outdated review notification dismissed');
      }

      return result;
    }

    // Fallback: just acknowledge
    await query.editMessageText('✅ Notification dismissed');
    return { success: true };
  }
}

module.exports = CallbackHandler;
