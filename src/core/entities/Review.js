/**
 * Review - Domain entity representing a code review
 *
 * This entity encapsulates review data and state.
 *
 * @example
 * const review = new Review({
 *   id: 'review-123',
 *   prId: 456,
 *   state: 'APPROVED',
 *   summary: 'LGTM',
 *   comments: [comment1, comment2]
 * });
 */
class Review {
  /**
   * @param {Object} data - Review data
   * @param {string} data.id - Review ID
   * @param {number} data.prId - Associated PR ID
   * @param {string} data.state - Review state (APPROVED, CHANGES_REQUESTED, COMMENT, DISMISSED)
   * @param {string} data.summary - Review summary message
   * @param {Array<ReviewComment>} data.comments - Review comments
   * @param {string} [data.submittedAt] - Submission timestamp
   * @param {string} [data.submittedBy] - Review submitter
   * @param {string} [data.headSha] - Head commit SHA
   */
  constructor(data) {
    this.id = data.id;
    this.prId = data.prId;
    this.state = data.state;
    this.summary = data.summary;
    this.comments = data.comments || [];
    this.submittedAt = data.submittedAt ? new Date(data.submittedAt) : null;
    this.submittedBy = data.submittedBy || null;
    this.headSha = data.headSha || null;
  }

  /**
   * Check if review is approved
   * @returns {boolean}
   */
  isApproved() {
    return this.state === 'APPROVED';
  }

  /**
   * Check if review requests changes
   * @returns {boolean}
   */
  isChangesRequested() {
    return this.state === 'REQUEST_CHANGES';
  }

  /**
   * Check if review is dismissed
   * @returns {boolean}
   */
  isDismissed() {
    return this.state === 'DISMISSED';
  }

  /**
   * Check if review has comments
   * @returns {boolean}
   */
  hasComments() {
    return this.comments.length > 0;
  }

  /**
   * Get high severity comments count
   * @returns {number}
   */
  getHighSeverityCount() {
    return this.comments.filter(c => c.severity === 'HIGH').length;
  }

  /**
   * Get medium severity comments count
   * @returns {number}
   */
  getMediumSeverityCount() {
    return this.comments.filter(c => c.severity === 'MEDIUM').length;
  }

  /**
   * Get low severity comments count
   * @returns {number}
   */
  getLowSeverityCount() {
    return this.comments.filter(c => c.severity === 'LOW').length;
  }

  /**
   * Get total comments count
   * @returns {number}
   */
  getCommentsCount() {
    return this.comments.length;
  }

  /**
   * Get severity breakdown
   * @returns {Object} Severity counts
   */
  getSeverityBreakdown() {
    return {
      HIGH: this.getHighSeverityCount(),
      MEDIUM: this.getMediumSeverityCount(),
      LOW: this.getLowSeverityCount()
    };
  }

  /**
   * Check if review requires changes
   * @returns {boolean}
   */
  requiresChanges() {
    return this.getHighSeverityCount() > 0;
  }

  /**
   * Convert to plain object for serialization
   * @returns {Object} Plain object representation
   */
  toJSON() {
    return {
      id: this.id,
      prId: this.prId,
      state: this.state,
      summary: this.summary,
      comments: this.comments,
      submittedAt: this.submittedAt ? this.submittedAt.toISOString() : null,
      submittedBy: this.submittedBy,
      headSha: this.headSha,
      hasComments: this.hasComments(),
      severityBreakdown: this.getSeverityBreakdown(),
      requiresChanges: this.requiresChanges()
    };
  }

  /**
   * Create Review from GitHub API response
   * @param {Object} githubReview - GitHub review object
   * @param {number} prId - Associated PR ID
   * @returns {Review} Review entity
   */
  static fromGitHubAPI(githubReview, prId) {
    return new Review({
      id: githubReview.id,
      prId: prId,
      state: githubReview.state,
      summary: githubReview.body || '',
      comments: githubReview.comments || [],
      submittedAt: githubReview.submitted_at,
      submittedBy: githubReview.user?.login,
      headSha: githubReview.commit_id
    });
  }
}

module.exports = Review;
