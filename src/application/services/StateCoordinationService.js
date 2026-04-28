/**
 * StateCoordinationService - Facade for coordinating multiple state managers
 *
 * This service provides a unified interface for managing state across different
 * concerns (PR processing, skip cache, notification tracking, etc.).
 *
 * It implements the Facade pattern to simplify the complexity of working with
 * multiple state repositories and the PR state machine.
 *
 * @example
 * const coordinator = new StateCoordinationService(stateMachine, skipCache, stateRepository, eventBus);
 * await coordinator.markPRAsNotified(instanceKey, repoName, prNumber);
 */

class StateCoordinationService {
  /**
   * @param {Object} stateMachine - PRStateMachine instance
   * @param {Object} skipCache - SkipCacheService instance (optional)
   * @param {Object} stateRepository - StateRepository instance
   * @param {Object} eventBus - EventBus instance
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   */
  constructor(stateMachine, skipCache, stateRepository, eventBus, options = {}) {
    this.stateMachine = stateMachine;
    this.skipCache = skipCache;
    this.stateRepository = stateRepository;
    this.eventBus = eventBus;
    this.logger = options.logger || console;
  }

  /**
   * Get comprehensive state for a PR
   *
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @returns {Promise<Object>} Comprehensive state information
   */
  async getPRState(instanceKey, repoName, prNumber) {
    const key = this._buildPRKey(instanceKey, repoName, prNumber);

    try {
      const [currentState, notificationCount, isSkipped, skipExpiry] = await Promise.all([
        this.stateMachine.getState(instanceKey, repoName, prNumber),
        this.stateMachine.getNotificationCount(instanceKey, repoName, prNumber),
        this.stateMachine.isSkipped(instanceKey, repoName, prNumber),
        this._getSkipExpiry(instanceKey, repoName, prNumber)
      ]);

      // Get additional state data
      const stateData = await this.stateRepository.get(key);

      return {
        prNumber,
        currentState,
        notificationCount,
        isSkipped,
        skipExpiry,
        isTerminal: this.stateMachine.isTerminalState(currentState),
        shouldNotify: await this.stateMachine.shouldNotify(instanceKey, repoName, prNumber),
        lastUpdated: stateData?.lastUpdated || null,
        transitions: stateData?.transitions || []
      };

    } catch (error) {
      this.logger.error(`[StateCoordination] Error getting state for PR #${prNumber}:`, error);
      throw error;
    }
  }

  /**
   * Mark PR as notified (increment counter and update state)
   *
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @param {Object} metadata - Optional metadata to store
   * @returns {Promise<Object>} Updated state
   */
  async markPRAsNotified(instanceKey, repoName, prNumber, metadata = {}) {
    try {
      const result = await this.stateMachine.transition(
        instanceKey,
        repoName,
        prNumber,
        'notified',
        metadata
      );

      // Emit state change event
      await this.eventBus.emitAsync('state.pr.notified', {
        instanceKey,
        repoName,
        prNumber,
        notificationCount: result.notificationCount
      });

      this.logger.debug(
        `[StateCoordination] PR #${prNumber} marked as notified ` +
        `(count: ${result.notificationCount})`
      );

      return result;

    } catch (error) {
      this.logger.error(`[StateCoordination] Error marking PR #${prNumber} as notified:`, error);
      throw error;
    }
  }

  /**
   * Mark PR as processed (terminal state)
   *
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @param {string} reason - Reason for marking as processed
   * @returns {Promise<Object>} Updated state
   */
  async markPRAsProcessed(instanceKey, repoName, prNumber, reason = 'Manual') {
    try {
      const result = await this.stateMachine.markAsProcessed(
        instanceKey,
        repoName,
        prNumber,
        { reason }
      );

      // Emit state change event
      await this.eventBus.emitAsync('state.'pr.processed'', {
        instanceKey,
        repoName,
        prNumber,
        reason
      });

      this.logger.info(
        `[StateCoordination] PR #${prNumber} marked as processed (${reason})`
      );

      return result;

    } catch (error) {
      this.logger.error(`[StateCoordination] Error marking PR #${prNumber} as processed:`, error);
      throw error;
    }
  }

  /**
   * Skip notifications for a PR temporarily
   *
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @param {number} duration - Skip duration in milliseconds
   * @returns {Promise<Object>} Skip result
   */
  async skipPRNotifications(instanceKey, repoName, prNumber, duration) {
    try {
      const result = await this.stateMachine.markAsSkipped(
        instanceKey,
        repoName,
        prNumber,
        duration
      );

      // Emit skip event
      await this.eventBus.emitAsync('state.pr.skipped', {
        instanceKey,
        repoName,
        prNumber,
        duration,
        skipUntil: new Date(Date.now() + duration).toISOString()
      });

      this.logger.info(
        `[StateCoordination] PR #${prNumber} notifications skipped for ${duration}ms`
      );

      return result;

    } catch (error) {
      this.logger.error(`[StateCoordination] Error skipping notifications for PR #${prNumber}:`, error);
      throw error;
    }
  }

  /**
   * Get all PRs that need processing
   *
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @returns {Promise<Array<number>>} Array of PR numbers
   */
  async getPRsNeedingProcessing(instanceKey, repoName) {
    try {
      // Get all PRs in non-terminal states
      const pendingPRs = await this.stateMachine.getPRsByState(
        instanceKey,
        repoName,
        'pending'
      );

      const notifiedPRs = await this.stateMachine.getPRsByState(
        instanceKey,
        repoName,
        'notified'
      );

      // Filter out skipped PRs
      const allPRs = [...pendingPRs, ...notifiedPRs];
      const activePRs = [];

      for (const prNumber of allPRs) {
        const isSkipped = await this.stateMachine.isSkipped(instanceKey, repoName, prNumber);
        if (!isSkipped) {
          activePRs.push(prNumber);
        }
      }

      return activePRs;

    } catch (error) {
      this.logger.error(
        `[StateCoordination] Error getting PRs needing processing:`,
        error
      );
      throw error;
    }
  }

  /**
   * Get state summary for a repository
   *
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @returns {Promise<Object>} State summary
   */
  async getRepoStateSummary(instanceKey, repoName) {
    try {
      const states = ['pending', 'notified', 'approved', 'rejected', 'closed', 'processed', 'skipped'];
      const summary = {};

      for (const state of states) {
        summary[state] = await this.stateMachine.getPRsByState(instanceKey, repoName, state);
      }

      return {
        instanceKey,
        repoName,
        states: summary,
        totalPRs: Object.values(summary).reduce((sum, prs) => sum + prs.length, 0)
      };

    } catch (error) {
      this.logger.error(
        `[StateCoordination] Error getting repo state summary:`,
        error
      );
      throw error;
    }
  }

  /**
   * Reset PR state (for testing or manual intervention)
   *
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @returns {Promise<void>}
   */
  async resetPRState(instanceKey, repoName, prNumber) {
    try {
      await this.stateMachine.reset(instanceKey, repoName, prNumber);

      // Emit reset event
      await this.eventBus.emitAsync('state.pr.reset', {
        instanceKey,
        repoName,
        prNumber
      });

      this.logger.info(`[StateCoordination] PR #${prNumber} state reset`);

    } catch (error) {
      this.logger.error(`[StateCoordination] Error resetting PR #${prNumber} state:`, error);
      throw error;
    }
  }

  /**
   * Batch update multiple PR states
   *
   * @param {Array<Object>} updates - Array of update objects
   * @returns {Promise<Array<Object>>} Update results
   */
  async batchUpdatePRStates(updates) {
    const results = [];

    for (const update of updates) {
      const { instanceKey, repoName, prNumber, action, data } = update;

      try {
        let result;
        switch (action) {
          case 'markNotified':
            result = await this.markPRAsNotified(instanceKey, repoName, prNumber, data);
            break;
          case 'markProcessed':
            result = await this.markPRAsProcessed(instanceKey, repoName, prNumber, data.reason);
            break;
          case 'skip':
            result = await this.skipPRNotifications(instanceKey, repoName, prNumber, data.duration);
            break;
          case 'reset':
            result = await this.resetPRState(instanceKey, repoName, prNumber);
            break;
          default:
            throw new Error(`Unknown action: ${action}`);
        }

        results.push({
          instanceKey,
          repoName,
          prNumber,
          action,
          success: true,
          result
        });

      } catch (error) {
        results.push({
          instanceKey,
          repoName,
          prNumber,
          action,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Get skip expiry time
   * @private
   */
  async _getSkipExpiry(instanceKey, repoName, prNumber) {
    const key = this._buildPRKey(instanceKey, repoName, prNumber);
    const stateData = await this.stateRepository.get(key);

    if (!stateData?.transitions) {
      return null;
    }

    // Find last skip transition
    const skipTransitions = stateData.transitions.filter(
      t => t.to === 'skipped'
    );

    if (skipTransitions.length === 0) {
      return null;
    }

    const lastSkip = skipTransitions[skipTransitions.length - 1];
    return lastSkip.metadata?.skipUntil || null;
  }

  /**
   * Build PR state key
   * @private
   */
  _buildPRKey(instanceKey, repoName, prNumber) {
    return `${instanceKey}/${repoName}/pr/${prNumber}`;
  }

  /**
   * Export state for backup/migration
   *
   * @param {string} instanceKey - Instance key (optional)
   * @param {string} repoName - Repository name (optional)
   * @returns {Promise<Object>} Exported state data
   */
  async exportState(instanceKey = null, repoName = null) {
    // This would export all state data for the given scope
    // Implementation depends on state repository capabilities
    this.logger.warn('[StateCoordination] exportState not yet implemented');
    return {};
  }

  /**
   * Import state from backup/migration
   *
   * @param {Object} stateData - State data to import
   * @returns {Promise<Object>} Import result
   */
  async importState(stateData) {
    // This would import state data from a backup
    // Implementation depends on state repository capabilities
    this.logger.warn('[StateCoordination] importState not yet implemented');
    return {};
  }
}

module.exports = StateCoordinationService;
