/**
 * UnifiedStateService - Consolidated state management for all PR-related state
 *
 * This service consolidates the functionality of:
 * - RepositoryStateManager (PR processing, notification counts)
 * - SkipManager (temporary skip cache)
 * - ReviewStateManager (review state tracking)
 *
 * It uses the PRStateMachine as the core and provides a unified interface
 * for all state operations.
 *
 * @example
 * const stateService = new UnifiedStateService(stateMachine, stateRepository, eventBus, logger);
 * await stateService.markPRAsNotified(instanceKey, repoName, prNumber);
 */

class UnifiedStateService {
  /**
   * @param {Object} stateMachine - PRStateMachine instance
   * @param {Object} stateRepository - StateRepository instance
   * @param {Object} eventBus - EventBus instance
   * @param {Object} logger - Logger instance
   */
  constructor(stateMachine, stateRepository, eventBus, logger) {
    this.stateMachine = stateMachine;
    this.stateRepository = stateRepository;
    this.eventBus = eventBus;
    this.logger = logger;
  }

  // ===== PR Processing State =====

  /**
   * Check if a PR has been fully processed
   * @param {string} instanceKey - Instance key (e.g., 'github/org')
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @returns {Promise<boolean>} True if PR is fully processed
   */
  async isProcessed(instanceKey, repoName, prNumber) {
    const state = await this.stateMachine.getState(instanceKey, repoName, prNumber);
    return this.stateMachine.isTerminalState(state);
  }

  /**
   * Mark a PR as fully processed
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @returns {Promise<Object>} Updated state
   */
  async markProcessed(instanceKey, repoName, prNumber) {
    const result = await this.stateMachine.transition(
      instanceKey,
      repoName,
      prNumber,
      'processed'
    );

    await this.eventBus.emitAsync('state.pr.processed', {
      instanceKey,
      repoName,
      prNumber
    });

    this.logger.info(
      `[UnifiedState] Marked PR #${prNumber} in ${instanceKey}/${repoName} as processed`
    );

    return result;
  }

  // ===== Notification Management =====

  /**
   * Get current notification count for a PR
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @returns {Promise<number>} Notification count
   */
  async getNotificationCount(instanceKey, repoName, prNumber) {
    return await this.stateMachine.getNotificationCount(instanceKey, repoName, prNumber);
  }

  /**
   * Mark PR as notified (increments counter and transitions state)
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @param {Object} metadata - Optional metadata
   * @returns {Promise<Object>} Updated state
   */
  async markPRAsNotified(instanceKey, repoName, prNumber, metadata = {}) {
    const result = await this.stateMachine.transition(
      instanceKey,
      repoName,
      prNumber,
      'notified',
      metadata
    );

    await this.eventBus.emitAsync('state.pr.notified', {
      instanceKey,
      repoName,
      prNumber,
      notificationCount: result.notificationCount
    });

    this.logger.debug(
      `[UnifiedState] PR #${prNumber} in ${instanceKey}/${repoName} marked as notified (${result.notificationCount}/${this.stateMachine.maxNotifications})`
    );

    return result;
  }

  /**
   * Check if PR should be notified (under limit and not skipped/processed)
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @returns {Promise<boolean>} True if PR should be notified
   */
  async shouldNotify(instanceKey, repoName, prNumber) {
    return await this.stateMachine.shouldNotify(instanceKey, repoName, prNumber);
  }

  // ===== Skip Cache Management =====

  /**
   * Check if a PR is currently skipped
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @returns {Promise<boolean>} True if PR is skipped
   */
  async isSkipped(instanceKey, repoName, prNumber) {
    return await this.stateMachine.isSkipped(instanceKey, repoName, prNumber);
  }

  /**
   * Add a temporary skip for a PR
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @param {number} durationHours - Skip duration in hours (default: 3)
   * @returns {Promise<Object>} Skip expiry time
   */
  async skipPRNotifications(instanceKey, repoName, prNumber, durationHours = 3) {
    const result = await this.stateMachine.transition(
      instanceKey,
      repoName,
      prNumber,
      'skipped',
      { durationHours }
    );

    await this.eventBus.emitAsync('state.pr.skipped', {
      instanceKey,
      repoName,
      prNumber,
      durationHours,
      expiresAt: result.skipExpiry
    });

    this.logger.info(
      `[UnifiedState] Skipped notifications for PR #${prNumber} in ${instanceKey}/${repoName} for ${durationHours}h`
    );

    return result;
  }

  /**
   * Remove skip for a PR (allow notifications again)
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @returns {Promise<Object>} Updated state
   */
  async removeSkip(instanceKey, repoName, prNumber) {
    const currentState = await this.stateMachine.getState(instanceKey, repoName, prNumber);

    // Only can remove skip if currently skipped
    if (currentState !== 'skipped') {
      return { currentState };
    }

    const result = await this.stateMachine.transition(
      instanceKey,
      repoName,
      prNumber,
      'pending' // Back to pending state
    );

    await this.eventBus.emitAsync('state.pr.skip_removed', {
      instanceKey,
      repoName,
      prNumber
    });

    this.logger.debug(
      `[UnifiedState] Removed skip for PR #${prNumber} in ${instanceKey}/${repoName}`
    );

    return result;
  }

  // ===== Review State Management =====

  /**
   * Update review state for a PR
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @param {Object} reviewData - Review data
   * @returns {Promise<Object>} Updated review state
   */
  async updateReviewState(instanceKey, repoName, prNumber, reviewData) {
    const key = this._buildPRKey(instanceKey, repoName, prNumber);

    const stateData = await this.stateRepository.get(key) || {};
    stateData.reviewState = {
      ...stateData.reviewState,
      ...reviewData,
      lastChecked: new Date().toISOString()
    };

    await this.stateRepository.set(key, stateData);

    // Emit event if review is outdated
    if (reviewData.hasOutdated && !reviewData.dismissed) {
      await this.eventBus.emitAsync('state.review.outdated', {
        instanceKey,
        repoName,
        prNumber,
        reviewState: stateData.reviewState
      });
    }

    this.logger.debug(
      `[UnifiedState] Updated review state for PR #${prNumber} in ${instanceKey}/${repoName}`
    );

    return stateData.reviewState;
  }

  /**
   * Get review state for a PR
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @returns {Promise<Object|null>} Review state or null
   */
  async getReviewState(instanceKey, repoName, prNumber) {
    const key = this._buildPRKey(instanceKey, repoName, prNumber);
    const stateData = await this.stateRepository.get(key);
    return stateData?.reviewState || null;
  }

  /**
   * Check if PR review is outdated (new commits since review)
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @param {string} currentHeadSha - Current commit SHA
   * @returns {Promise<boolean>} True if review is outdated
   */
  async isReviewOutdated(instanceKey, repoName, prNumber, currentHeadSha) {
    const reviewState = await this.getReviewState(instanceKey, repoName, prNumber);

    if (!reviewState || reviewState.dismissed) {
      return false;
    }

    return reviewState.headSha !== currentHeadSha && reviewState.hasOutdated;
  }

  /**
   * Mark outdated review as dismissed
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @returns {Promise<Object>} Updated review state
   */
  async dismissOutdatedReview(instanceKey, repoName, prNumber) {
    const reviewState = await this.getReviewState(instanceKey, repoName, prNumber);

    if (reviewState) {
      reviewState.dismissed = true;
      reviewState.dismissedAt = new Date().toISOString();

      const key = this._buildPRKey(instanceKey, repoName, prNumber);
      const stateData = await this.stateRepository.get(key);
      stateData.reviewState = reviewState;

      await this.stateRepository.set(key, stateData);

      await this.eventBus.emitAsync('state.review.dismissed', {
        instanceKey,
        repoName,
        prNumber
      });

      this.logger.info(
        `[UnifiedState] Dismissed outdated review for PR #${prNumber} in ${instanceKey}/${repoName}`
      );
    }

    return reviewState;
  }

  /**
   * Clear review state for a PR
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @returns {Promise<void>}
   */
  async clearReviewState(instanceKey, repoName, prNumber) {
    const key = this._buildPRKey(instanceKey, repoName, prNumber);
    const stateData = await this.stateRepository.get(key);

    if (stateData && stateData.reviewState) {
      delete stateData.reviewState;
      await this.stateRepository.set(key, stateData);

      this.logger.debug(
        `[UnifiedState] Cleared review state for PR #${prNumber} in ${instanceKey}/${repoName}`
      );
    }
  }

  // ===== Comprehensive State Queries =====

  /**
   * Get comprehensive state for a PR
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @returns {Promise<Object>} Complete state information
   */
  async getPRState(instanceKey, repoName, prNumber) {
    const key = this._buildPRKey(instanceKey, repoName, prNumber);

    const [currentState, notificationCount, isSkipped, skipExpiry, stateData] = await Promise.all([
      this.stateMachine.getState(instanceKey, repoName, prNumber),
      this.stateMachine.getNotificationCount(instanceKey, repoName, prNumber),
      this.stateMachine.isSkipped(instanceKey, repoName, prNumber),
      this.stateMachine.getSkipExpiry(instanceKey, repoName, prNumber),
      this.stateRepository.get(key)
    ]);

    return {
      prNumber,
      currentState,
      notificationCount,
      isSkipped,
      skipExpiry,
      isTerminal: this.stateMachine.isTerminalState(currentState),
      shouldNotify: await this.stateMachine.shouldNotify(instanceKey, repoName, prNumber),
      reviewState: stateData?.reviewState || null,
      lastUpdated: stateData?.lastUpdated || null,
      transitions: stateData?.transitions || []
    };
  }

  /**
   * Get statistics across all repositories
   * @returns {Promise<Object>} Statistics
   */
  async getStats() {
    const stats = {
      totalRepos: 0,
      totalProcessedPRs: 0,
      totalNotifications: 0,
      totalSkipped: 0,
      totalOutdatedReviews: 0
    };

    try {
      // Get all keys from repository
      const allKeys = await this.stateRepository.keys();

      // Track unique repos
      const repoKeys = new Set();

      for (const key of allKeys) {
        const stateData = await this.stateRepository.get(key);

        if (stateData?.state === 'processed') {
          stats.totalProcessedPRs++;
        }

        if (stateData?.notificationCount) {
          stats.totalNotifications += stateData.notificationCount;
        }

        if (stateData?.state === 'skipped') {
          stats.totalSkipped++;
        }

        if (stateData?.reviewState?.hasOutdated && !stateData.reviewState?.dismissed) {
          stats.totalOutdatedReviews++;
        }

        // Extract repo key
        const match = key.match(/^([^:]+):([^:]+):/);
        if (match) {
          repoKeys.add(`${match[1]}:${match[2]}`);
        }
      }

      stats.totalRepos = repoKeys.size;
    } catch (error) {
      this.logger.error('[UnifiedState] Error getting stats:', error);
    }

    return stats;
  }

  /**
   * Cleanup old entries to prevent unbounded growth
   * @param {number} maxAgeDays - Maximum age in days (default: 7)
   * @returns {Promise<number>} Number of entries cleaned
   */
  async cleanupOldEntries(maxAgeDays = 7) {
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let cleaned = 0;

    try {
      const allKeys = await this.stateRepository.keys();

      for (const key of allKeys) {
        const stateData = await this.stateRepository.get(key);

        if (!stateData?.lastUpdated) continue;

        const lastUpdated = new Date(stateData.lastUpdated).getTime();
        const age = now - lastUpdated;

        // Only clean up entries that are in terminal states
        if (age > maxAgeMs && this.stateMachine.isTerminalState(stateData.state)) {
          await this.stateRepository.delete(key);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        this.logger.info(
          `[UnifiedState] Cleaned up ${cleaned} old PR entries (older than ${maxAgeDays} days)`
        );
      }
    } catch (error) {
      this.logger.error('[UnifiedState] Error during cleanup:', error);
    }

    return cleaned;
  }

  // ===== Private Methods =====

  /**
   * Build state key for a PR
   * @private
   */
  _buildPRKey(instanceKey, repoName, prNumber) {
    return `${instanceKey}:${repoName}:${prNumber}`;
  }

  /**
   * Get skip expiry time for a PR
   * @private
   */
  async _getSkipExpiry(instanceKey, repoName, prNumber) {
    return await this.stateMachine.getSkipExpiry(instanceKey, repoName, prNumber);
  }
}

module.exports = UnifiedStateService;
