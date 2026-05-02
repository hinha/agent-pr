/**
 * PullRequest - Domain entity representing a GitHub Pull Request
 *
 * This entity encapsulates the core properties and behaviors of a PR
 * in the domain model, independent of external service concerns.
 *
 * @example
 * const pr = new PullRequest({
 *   id: 123,
 *   number: 456,
 *   title: 'Fix bug in authentication',
 *   author: 'john-doe',
 *   owner: 'myorg',
 *   repo: 'my-repo'
 * });
 */
class PullRequest {
  /**
   * @param {Object} data - PR data
   * @param {number} data.id - PR internal ID
   * @param {number} data.number - PR number
   * @param {string} data.title - PR title
   * @param {string} data.url - PR URL
   * @param {string} data.author - PR author username
   * @param {Date|string} data.createdAt - PR creation date
   * @param {string} data.description - PR description/body
   * @param {string} data.baseBranch - Base branch name
   * @param {string} data.headBranch - Head branch name
   * @param {string} data.headSha - Head commit SHA
   * @param {string} data.owner - Repository owner
   * @param {string} data.repo - Repository name
   * @param {Array<FileChange>} [data.files] - Files changed in PR
   */
  constructor(data) {
    this.id = data.id;
    this.number = data.number;
    this.title = data.title;
    this.url = data.url;
    this.author = data.author;
    this.createdAt = data.createdAt instanceof Date ? data.createdAt : new Date(data.createdAt);
    this.description = data.description || '';
    this.baseBranch = data.baseBranch;
    this.headBranch = data.headBranch;
    this.headSha = data.headSha;
    this.owner = data.owner;
    this.repo = data.repo;
    this.files = data.files || [];
  }

  /**
   * Get PR age in hours
   * @returns {number} Age in hours
   */
  getAgeInHours() {
    return Math.floor((Date.now() - this.createdAt.getTime()) / (1000 * 60 * 60));
  }

  /**
   * Get PR age in milliseconds
   * @returns {number} Age in milliseconds
   */
  getAgeInMs() {
    return Date.now() - this.createdAt.getTime();
  }

  /**
   * Check if PR is older than specified hours
   * @param {number} maxAgeHours - Maximum age in hours
   * @returns {boolean} True if PR is older than max age
   */
  isOlderThan(maxAgeHours) {
    return this.getAgeInMs() > (maxAgeHours * 60 * 60 * 1000);
  }

  /**
   * Get unique identifier for this PR
   * @returns {string} Unique identifier
   */
  getIdentifier() {
    return `${this.owner}/${this.repo}/${this.number}`;
  }

  /**
   * Get formatted display string
   * @returns {string} Formatted PR reference
   */
  toDisplayString() {
    return `${this.owner}/${this.repo}#${this.number}`;
  }

  /**
   * Check if PR is a fix (title contains 'fix')
   * @returns {boolean}
   */
  isFix() {
    return /fix/i.test(this.title);
  }

  /**
   * Check if PR is a feature (title contains 'feat')
   * @returns {boolean}
   */
  isFeature() {
    return /feat/i.test(this.title);
  }

  /**
   * Get PR type category
   * @returns {string} PR type (bugfix, feature, other)
   */
  getType() {
    if (this.isFix()) return 'bugfix';
    if (this.isFeature()) return 'feature';
    return 'other';
  }

  /**
   * Convert to plain object for serialization
   * @returns {Object} Plain object representation
   */
  toJSON() {
    return {
      id: this.id,
      number: this.number,
      title: this.title,
      url: this.url,
      author: this.author,
      createdAt: this.createdAt.toISOString(),
      description: this.description,
      baseBranch: this.baseBranch,
      headBranch: this.headBranch,
      headSha: this.headSha,
      owner: this.owner,
      repo: this.repo,
      files: this.files,
      ageInHours: this.getAgeInHours(),
      type: this.getType()
    };
  }

  /**
   * Create PullRequest from GitHub API response
   * @param {Object} githubPR - GitHub PR object
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @returns {PullRequest} PullRequest entity
   */
  static fromGitHubAPI(githubPR, owner, repo) {
    return new PullRequest({
      id: githubPR.id,
      number: githubPR.number,
      title: githubPR.title,
      url: githubPR.html_url,
      author: githubPR.user?.login || 'unknown',
      createdAt: githubPR.created_at,
      description: githubPR.body || '',
      baseBranch: githubPR.base?.ref,
      headBranch: githubPR.head?.ref,
      headSha: githubPR.head?.sha,
      owner,
      repo
    });
  }
}

module.exports = PullRequest;
