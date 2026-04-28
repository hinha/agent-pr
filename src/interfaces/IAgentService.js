/**
 * @interface IAgentService
 *
 * Defines the contract for AI agent service implementations.
 * This interface abstracts AI code review operations, allowing different
 * agent implementations (OpenClaw, custom, mock) to be used.
 *
 * @example
 * class MyAgentService extends IAgentService {
 *   async reviewPR(pr, files, level) {
 *     // implementation
 *   }
 *   // ... implement other methods
 * }
 */
class IAgentService {
  /**
   * Review a pull request using AI
   *
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {PullRequest} pr - Pull request to review
   * @param {Array<FileChange>} files - Files changed in the PR
   * @param {string} level - Review level (low, medium, high)
   * @returns {Promise<ReviewResult>} Review result with comments
   * @throws {Error} When agent operation fails
   *
   * @example
   * const result = await agentService.reviewPR('myorg', 'my-repo', pr, files, 'high');
   * console.log(`Found ${result.comments.length} issues`);
   */
  async reviewPR(owner, repo, pr, files, level) {
    throw new Error('Method reviewPR must be implemented');
  }

  /**
   * Generate a summary for a pull request
   *
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {PullRequest} pr - Pull request to summarize
   * @param {Array<FileChange>} files - Files changed in the PR
   * @returns {Promise<string>} Generated summary
   * @throws {Error} When agent operation fails
   *
   * @example
   * const summary = await agentService.summarizePR('myorg', 'my-repo', pr, files);
   * console.log(`Summary: ${summary}`);
   */
  async summarizePR(owner, repo, pr, files) {
    throw new Error('Method summarizePR must be implemented');
  }

  /**
   * Get available review levels
   *
   * @returns {Array<string>} Array of available review levels
   *
   * @example
   * const levels = await agentService.getReviewLevels();
   * console.log(`Available levels: ${levels.join(', ')}`);
   */
  async getReviewLevels() {
    throw new Error('Method getReviewLevels must be implemented');
  }
}

/**
 * @typedef {Object} ReviewResult
 * @property {string} summary - Review summary
 * @property {Array<ReviewComment>} comments - Array of review comments
 * @property {string} level - Review level used
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

module.exports = IAgentService;
