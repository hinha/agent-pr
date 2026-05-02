/**
 * @interface IGitHubService
 *
 * Defines the contract for GitHub service implementations.
 * This interface abstracts GitHub operations, allowing different
 * implementations (MCP, REST API, mock) to be used interchangeably.
 *
 * @example
 * class MyGitHubService extends IGitHubService {
 *   async getOpenPRs(repo) {
 *     // implementation
 *   }
 *   // ... implement other methods
 * }
 */
class IGitHubService {
  /**
   * Get all open pull requests for a repository
   *
   * @param {string} repo - Repository name
   * @returns {Promise<Array<PullRequest>>} Array of open pull requests
   * @throws {MCPError} When MCP operation fails
   *
   * @example
   * const prs = await githubService.getOpenPRs('my-repo');
   * console.log(`Found ${prs.length} open PRs`);
   */
  async getOpenPRs(_repo) {
    throw new Error('Method getOpenPRs must be implemented');
  }

  /**
   * Get PR details including changed files and metadata
   *
   * @param {string} repo - Repository name
   * @param {number} prNumber - Pull request number
   * @returns {Promise<PRDetails>} PR details including files, changes, etc.
   * @throws {MCPError} When MCP operation fails
   *
   * @example
   * const details = await githubService.getPRDetails('my-repo', 123);
   * console.log(`PR has ${details.filesChanged} files changed`);
   */
  async getPRDetails(_repo, _prNumber) {
    throw new Error('Method getPRDetails must be implemented');
  }

  /**
   * Create a review with per-line comments
   *
   * @param {string} repo - Repository name
   * @param {PullRequest} pr - Pull request object
   * @param {ReviewResult} reviewResult - Review data with comments
   * @returns {Promise<Review>} Created review object
   * @throws {MCPError} When MCP operation fails
   *
   * @example
   * const review = await githubService.createReviewWithComments('my-repo', pr, {
   *   summary: 'Please review these changes',
   *   comments: [{ file: 'src/app.js', line: 10, message: 'Bug here', severity: 'HIGH' }]
   * });
   */
  async createReviewWithComments(_repo, _pr, _reviewResult) {
    throw new Error('Method createReviewWithComments must be implemented');
  }

  /**
   * Approve a pull request
   *
   * @param {string} repo - Repository name
   * @param {number} prNumber - Pull request number
   * @param {string} body - Approval message
   * @returns {Promise<void>}
   * @throws {MCPError} When MCP operation fails
   *
   * @example
   * await githubService.approvePR('my-repo', 123, 'LGTM!');
   */
  async approvePR(_repo, _prNumber, _body) {
    throw new Error('Method approvePR must be implemented');
  }

  /**
   * Request changes on a pull request
   *
   * @param {string} repo - Repository name
   * @param {number} prNumber - Pull request number
   * @param {string} body - Request changes message
   * @returns {Promise<void>}
   * @throws {MCPError} When MCP operation fails
   *
   * @example
   * await githubService.requestChanges('my-repo', 123, 'Please fix these issues');
   */
  async requestChanges(_repo, _prNumber, _body) {
    throw new Error('Method requestChanges must be implemented');
  }

  /**
   * Close a pull request
   *
   * @param {string} repo - Repository name
   * @param {number} prNumber - Pull request number
   * @returns {Promise<void>}
   * @throws {MCPError} When MCP operation fails
   *
   * @example
   * await githubService.closePR('my-repo', 123);
   */
  async closePR(_repo, _prNumber) {
    throw new Error('Method closePR must be implemented');
  }

  /**
   * Get all reviews for a pull request
   *
   * @param {string} repo - Repository name
   * @param {number} prNumber - Pull request number
   * @returns {Promise<Array<Review>>} Array of reviews
   * @throws {MCPError} When MCP operation fails
   */
  async getPRReviews(_repo, _prNumber) {
    throw new Error('Method getPRReviews must be implemented');
  }

  /**
   * Get all comments for a pull request
   *
   * @param {string} repo - Repository name
   * @param {number} prNumber - Pull request number
   * @returns {Promise<Array<Comment>>} Array of comments
   * @throws {MCPError} When MCP operation fails
   */
  async getPRComments(_repo, _prNumber) {
    throw new Error('Method getPRComments must be implemented');
  }

  /**
   * Clean up resources
   * @returns {void}
   */
  cleanup() {
    throw new Error('Method cleanup must be implemented');
  }
}

/**
 * @typedef {Object} PullRequest
 * @property {number} id - PR ID
 * @property {number} number - PR number
 * @property {string} title - PR title
 * @property {string} url - PR URL
 * @property {string} author - PR author username
 * @property {Date} createdAt - PR creation date
 * @property {string} description - PR description/body
 * @property {string} baseBranch - Base branch name
 * @property {string} headBranch - Head branch name
 * @property {string} headSha - Head commit SHA
 * @property {string} owner - Repository owner
 * @property {string} repo - Repository name
 */

/**
 * @typedef {Object} PRDetails
 * @property {number} filesChanged - Number of files changed
 * @property {Array<FileChange>} files - Array of file changes
 * @property {number} totalChanges - Total number of changes (additions + deletions)
 * @property {number} totalFilesChanged - Total files including test files
 */

/**
 * @typedef {Object} FileChange
 * @property {string} filename - File path
 * @property {number} additions - Number of lines added
 * @property {number} deletions - Number of lines deleted
 * @property {number} changes - Total number of changes
 * @property {string} status - File change status (modified, added, deleted)
 */

/**
 * @typedef {Object} ReviewResult
 * @property {string} summary - Review summary message
 * @property {Array<ReviewComment>} comments - Array of line comments
 * @property {boolean} agentCalledToolDirectly - Whether agent called the tool directly
 * @property {string} agentRawOutput - Raw output from agent
 */

/**
 * @typedef {Object} ReviewComment
 * @property {string} file - File path
 * @property {number} line - Line number
 * @property {string} message - Comment message
 * @property {string} severity - Comment severity (LOW, MEDIUM, HIGH)
 * @property {string} [suggestedCode] - Suggested code fix (optional)
 */

/**
 * @typedef {Object} Review
 * @property {string} id - Review ID
 * @property {string} html_url - Review URL
 * @property {string} submitted_at - Submission timestamp
 * @property {string} event - Review event (APPROVE, REQUEST_CHANGES, COMMENT)
 * @property {string} body - Review body
 */

module.exports = IGitHubService;
