/**
 * PRStateMachine - Domain service for managing PR state transitions
 *
 * This service consolidates scattered state management across the codebase
 * into a single, centralized state machine with well-defined transitions.
 *
 * Supported states:
 * - PENDING: PR is newly discovered, awaiting first review
 * - NOTIFIED: Review has been sent to Telegram, awaiting response
 * - APPROVED: PR has been approved
 * - REJECTED: PR has been rejected/changes requested
 * - CLOSED: PR has been closed
 * - PROCESSED: PR has been fully processed (won't be notified again)
 * - SKIPPED: PR notifications are temporarily suppressed
 *
 * @example
 * const stateMachine = new PRStateMachine(stateRepository);
 * await stateMachine.transition(prNumber, 'PENDING', 'NOTIFIED');
 */

/**
 * PR state enumeration
 * @readonly
 * @enum {string}
 */
const PRState = {
  PENDING: 'pending',
  NOTIFIED: 'notified',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CLOSED: 'closed',
  PROCESSED: 'processed',
  SKIPPED: 'skipped'
};

/**
 * Valid state transitions
 * Format: currentState -> [allowedNextStates]
 */
const VALID_TRANSITIONS = {
  [PRState.PENDING]: [PRState.NOTIFIED, PRState.APPROVED, PRState.REJECTED, PRState.CLOSED, PRState.SKIPPED],
  [PRState.NOTIFIED]: [PRState.APPROVED, PRState.REJECTED, PRState.CLOSED, PRState.SKIPPED, PRState.PROCESSED, PRState.NOTIFIED],
  [PRState.APPROVED]: [PRState.PROCESSED, PRState.CLOSED],
  [PRState.REJECTED]: [PRState.PENDING, PRState.NOTIFIED, PRState.CLOSED],
  [PRState.CLOSED]: [PRState.PROCESSED],
  [PRState.PROCESSED]: [], // Terminal state
  [PRState.SKIPPED]: [PRState.PENDING, PRState.NOTIFIED, PRState.APPROVED, PRState.REJECTED]
};

/**
 * Terminal states (no further transitions allowed)
 */
const TERMINAL_STATES = [PRState.PROCESSED];

/**
 * States that count towards notification limit
 */
const NOTIFICATION_COUNTING_STATES = [PRState.NOTIFIED];

class PRStateMachine {
  /**
   * @param {Object} stateRepository - State repository instance
   * @param {Object} options - Configuration options
   * @param {Object} options.logger - Logger instance
   * @param {number} options.maxNotifications - Maximum notifications before marking as processed (default: 3)
   */
  constructor(stateRepository, options = {}) {
    if (!stateRepository) {
      throw new Error('State repository is required');
    }

    this.stateRepository = stateRepository;
    this.logger = options.logger || console;
    this.maxNotifications = options.maxNotifications || 3;
  }

  /**
   * Get current state of a PR
   *
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @returns {Promise<string>} Current state
   */
  async getState(instanceKey, repoName, prNumber) {
    const key = this._buildStateKey(instanceKey, repoName, prNumber);
    const stateData = await this.stateRepository.get(key);

    if (!stateData) {
      return PRState.PENDING; // Default state for new PRs
    }

    return stateData.state || PRState.PENDING;
  }

  /**
   * Transition a PR to a new state
   *
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @param {string} newState - New state to transition to
   * @param {Object} metadata - Optional metadata to store with the state
   * @returns {Promise<Object>} Transition result
   */
  async transition(instanceKey, repoName, prNumber, newState, metadata = {}) {
    const currentState = await this.getState(instanceKey, repoName, prNumber);

    // Validate transition
    if (!this._isValidTransition(currentState, newState)) {
      const error = `Invalid state transition from ${currentState} to ${newState}`;
      this.logger.warn(`[PRStateMachine] PR #${prNumber}: ${error}`);
      throw new Error(error);
    }

    const key = this._buildStateKey(instanceKey, repoName, prNumber);
    const timestamp = new Date().toISOString();

    // Get current notification count
    const currentCount = await this.getNotificationCount(instanceKey, repoName, prNumber);
    let newCount = currentCount;

    // Update notification count for notifying states
    // For NOTIFIED state, always increment (including self-transitions for re-notification)
    if (NOTIFICATION_COUNTING_STATES.includes(newState)) {
      newCount = currentCount + 1;
    }

    // Build state data
    const stateData = {
      state: newState,
      previousState: currentState,
      notificationCount: newCount,
      lastUpdated: timestamp,
      transitions: (await this._getTransitions(instanceKey, repoName, prNumber)).concat({
        from: currentState,
        to: newState,
        timestamp,
        metadata
      })
    };

    // Persist state
    await this.stateRepository.set(key, stateData);

    this.logger.debug(
      `[PRStateMachine] PR #${prNumber}: ${currentState} -> ${newState} (notifications: ${newCount})`
    );

    return {
      currentState: newState,
      previousState: currentState,
      notificationCount: newCount,
      isProcessed: this.isTerminalState(newState),
      shouldNotify: this.shouldNotify(instanceKey, repoName, prNumber, newState)
    };
  }

  /**
   * Check if a transition is valid
   *
   * @param {string} fromState - Current state
   * @param {string} toState - Target state
   * @returns {boolean}
   */
  _isValidTransition(fromState, toState) {
    if (fromState === toState) {
      // Allow self-transitions for NOTIFIED state (re-notification)
      return fromState === PRState.NOTIFIED;
    }

    const allowedTransitions = VALID_TRANSITIONS[fromState];
    return allowedTransitions ? allowedTransitions.includes(toState) : false;
  }

  /**
   * Get notification count for a PR
   *
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @returns {Promise<number>} Notification count
   */
  async getNotificationCount(instanceKey, repoName, prNumber) {
    const key = this._buildStateKey(instanceKey, repoName, prNumber);
    const stateData = await this.stateRepository.get(key);

    // First try to get from reviewState (current state)
    if (stateData && stateData.notificationCount !== undefined) {
      return stateData.notificationCount;
    }

    // Fallback: read directly from notification_counts.json file
    // This ensures we always get the persisted count, not stale cache
    try {
      const parsedKey = this.stateRepository._parseKey(key);
      if (parsedKey) {
        const fsRepo = this.stateRepository.getRepository(parsedKey.owner, parsedKey.repoName);
        if (fsRepo) {
          // Read directly from file to ensure we get the actual persisted value
          const count = await fsRepo._readNotificationCountFromFile(prNumber);
          if (count !== undefined) {
            return count;
          }
        }
      }
    } catch (err) {
      // Ignore errors
    }

    return 0;
  }

  /**
   * Check if PR should be notified
   *
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @param {string} currentState - Current state (optional, will fetch if not provided)
   * @returns {Promise<boolean>}
   */
  async shouldNotify(instanceKey, repoName, prNumber, currentState = null) {
    const state = currentState || await this.getState(instanceKey, repoName, prNumber);
    const count = await this.getNotificationCount(instanceKey, repoName, prNumber);

    // Don't notify if already processed or in terminal state
    if (this.isTerminalState(state)) {
      return false;
    }

    // Don't notify if max notifications reached
    if (count >= this.maxNotifications) {
      this.logger.debug(
        `[PRStateMachine] PR #${prNumber}: Max notifications reached (${count})`
      );
      return false;
    }

    return true;
  }

  /**
   * Check if a state is terminal (no further transitions)
   *
   * @param {string} state - State to check
   * @returns {boolean}
   */
  isTerminalState(state) {
    return TERMINAL_STATES.includes(state);
  }

  /**
   * Check if PR is in a specific state
   *
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @param {string} state - State to check
   * @returns {Promise<boolean>}
   */
  async isInState(instanceKey, repoName, prNumber, state) {
    const currentState = await this.getState(instanceKey, repoName, prNumber);
    return currentState === state;
  }

  /**
   * Mark PR as processed (terminal state)
   *
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @param {Object} metadata - Optional metadata
   * @returns {Promise<Object>} Transition result
   */
  async markAsProcessed(instanceKey, repoName, prNumber, metadata = {}) {
    return this.transition(instanceKey, repoName, prNumber, PRState.PROCESSED, {
      ...metadata,
      reason: 'Marked as processed'
    });
  }

  /**
   * Mark PR as skipped (temporary suppression)
   *
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @param {number} duration - Skip duration in milliseconds
   * @returns {Promise<Object>} Transition result
   */
  async markAsSkipped(instanceKey, repoName, prNumber, duration) {
    const skipUntil = new Date(Date.now() + duration).toISOString();

    return this.transition(instanceKey, repoName, prNumber, PRState.SKIPPED, {
      skipUntil,
      duration
    });
  }

  /**
   * Check if PR is currently skipped
   *
   * Checks both the current state and any active skip metadata in transitions.
   * This allows skip to work even when PR is in a terminal state (approved, rejected, etc.)
   *
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @returns {Promise<boolean>}
   */
  async isSkipped(instanceKey, repoName, prNumber) {
    const key = this._buildStateKey(instanceKey, repoName, prNumber);
    const stateData = await this.stateRepository.get(key);

    if (!stateData?.transitions) {
      return false;
    }

    // Find the most recent skip transition in the history
    // This allows skip to work regardless of current state
    for (let i = stateData.transitions.length - 1; i >= 0; i--) {
      const transition = stateData.transitions[i];

      // Check if this transition was a skip action (has skipUntil metadata)
      if (transition.metadata?.skipUntil) {
        const skipUntil = new Date(transition.metadata.skipUntil);

        // Check if skip period has expired
        if (new Date() > skipUntil) {
          // Skip expired - clean up and return false
          // Don't auto-transition to avoid disrupting current state
          return false;
        }

        // Found active skip
        return true;
      }
    }

    // Also check if current state is SKIPPED for backward compatibility
    const state = await this.getState(instanceKey, repoName, prNumber);
    if (state === PRState.SKIPPED) {
      return true;
    }

    return false;
  }

  /**
   * Get transition history for a PR
   *
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @returns {Promise<Array>} Transition history
   */
  async getTransitions(instanceKey, repoName, prNumber) {
    return this._getTransitions(instanceKey, repoName, prNumber);
  }

  /**
   * Get all PRs in a specific state
   *
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {string} state - State to filter by
   * @returns {Promise<Array<number>>} Array of PR numbers
   */
  async getPRsByState(instanceKey, repoName, state) {
    const prefix = this._buildStatePrefix(instanceKey, repoName);
    const allKeys = await this.stateRepository.keys(prefix);
    const prs = [];

    for (const key of allKeys) {
      const stateData = await this.stateRepository.get(key);
      if (stateData?.state === state) {
        const prNumber = this._extractPRNumberFromKey(key);
        if (prNumber) {
          prs.push(prNumber);
        }
      }
    }

    return prs;
  }

  /**
   * Reset PR state (for testing or manual intervention)
   *
   * @param {string} instanceKey - Instance key
   * @param {string} repoName - Repository name
   * @param {number} prNumber - PR number
   * @returns {Promise<void>}
   */
  async reset(instanceKey, repoName, prNumber) {
    const key = this._buildStateKey(instanceKey, repoName, prNumber);
    await this.stateRepository.delete(key);
    this.logger.debug(`[PRStateMachine] Reset PR #${prNumber} state`);
  }

  /**
   * Build state key for storage
   * @private
   */
  _buildStateKey(instanceKey, repoName, prNumber) {
    return `${instanceKey}/${repoName}/pr/${prNumber}`;
  }

  /**
   * Build state prefix for querying
   * @private
   */
  _buildStatePrefix(instanceKey, repoName) {
    return `${instanceKey}/${repoName}/pr/`;
  }

  /**
   * Extract PR number from state key
   * @private
   */
  _extractPRNumberFromKey(key) {
    const match = key.match(/\/pr\/(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Get transition history
   * @private
   */
  async _getTransitions(instanceKey, repoName, prNumber) {
    const key = this._buildStateKey(instanceKey, repoName, prNumber);
    const stateData = await this.stateRepository.get(key);

    return stateData?.transitions || [];
  }
}

// Export state constants
PRStateMachine.PRState = PRState;
PRStateMachine.VALID_TRANSITIONS = VALID_TRANSITIONS;
PRStateMachine.TERMINAL_STATES = TERMINAL_STATES;

module.exports = PRStateMachine;
