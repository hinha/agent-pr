/**
 * @interface ITelegramService
 *
 * Defines the contract for Telegram bot service implementations.
 * This interface abstracts Telegram operations, allowing different
 * implementations (actual bot, mock, logger-only) to be used.
 *
 * @example
 * class MyTelegramService extends ITelegramService {
 *   async sendPRNotification(notification) {
 *     // implementation
 *   }
 *   // ... implement other methods
 * }
 */
class ITelegramService {
  /**
   * Send a PR notification to Telegram
   *
   * @param {PRNotification} notification - PR notification data
   * @returns {Promise<void>}
   * @throws {Error} When sending notification fails
   *
   * @example
   * await telegramService.sendPRNotification({
   *   owner: 'myorg',
   *   repo: 'my-repo',
   *   pr: { id: 123, number: 456, title: 'Fix bug' },
   *   summary: { riskLevel: 'HIGH', impactArea: 'Security' },
   *   threadId: 789
   * });
   */
  async sendPRNotification(_notification) {
    throw new Error('Method sendPRNotification must be implemented');
  }

  /**
   * Send an outdated review notification to Telegram
   *
   * @param {OutdatedReviewNotification} notification - Outdated review notification data
   * @returns {Promise<void>}
   * @throws {Error} When sending notification fails
   *
   * @example
   * await telegramService.sendOutdatedReviewNotification({
   *   owner: 'myorg',
   *   repo: 'my-repo',
   *   pr: { id: 123, number: 456, title: 'Fix bug' },
   *   reviewState: { has_outdated: true, dismissed: false },
   *   threadId: 789
   * });
   */
  async sendOutdatedReviewNotification(_notification) {
    throw new Error('Method sendOutdatedReviewNotification must be implemented');
  }

  /**
   * Register a callback handler for a specific action
   *
   * @param {string} action - Action name (e.g., 'approve', 'reject', 'review_now')
   * @param {Function} handler - Handler function
   * @returns {void}
   *
   * @example
   * telegramService.registerCallbackHandler('approve', async (data) => {
   *   await githubService.approvePR(data.repo, data.prNumber, 'Approved');
   * });
   */
  registerCallbackHandler(_action, _handler) {
    throw new Error('Method registerCallbackHandler must be implemented');
  }

  /**
   * Start the Telegram bot
   *
   * @returns {Promise<void>}
   */
  async start() {
    throw new Error('Method start must be implemented');
  }

  /**
   * Stop the Telegram bot
   *
   * @returns {Promise<void>}
   */
  async stop() {
    throw new Error('Method stop must be implemented');
  }
}

/**
 * @typedef {Object} PRNotification
 * @property {string} owner - Repository owner
 * @property {string} repo - Repository name
 * @property {PullRequest} pr - Pull request object
 * @property {PRSummary} summary - PR analysis summary
 * @property {number} threadId - Telegram thread ID for this repository
 */

/**
 * @typedef {Object} PRSummary
 * @property {string} purpose - PR purpose/description
 * @property {string} type - PR type (bugfix, feature, other)
 * @property {string} riskLevel - Risk level (LOW, MEDIUM, HIGH)
 * @property {string} impactArea - Impact area description
 * @property {string} diffSize - Diff size description
 * @property {Array<string>} suspiciousPatterns - Suspicious patterns found
 * @property {string} recommendedReview - Recommended review level
 * @property {number} filesChanged - Number of files changed
 */

/**
 * @typedef {Object} OutdatedReviewNotification
 * @property {string} owner - Repository owner
 * @property {string} repo - Repository name
 * @property {PullRequest} pr - Pull request object
 * @property {ReviewState} reviewState - Review state information
 * @property {number} threadId - Telegram thread ID for this repository
 */

/**
 * @typedef {Object} ReviewState
 * @property {boolean} has_outdated - Whether review is outdated
 * @property {boolean} dismissed - Whether review was dismissed
 * @property {string} last_review_sha - Last reviewed commit SHA
 */

module.exports = ITelegramService;
