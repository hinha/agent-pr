/**
 * ReviewComment - Domain entity representing a review comment
 *
 * @example
 * const comment = new ReviewComment({
 *   file: 'src/app.js',
 *   line: 42,
 *   message: 'Bug here',
 *   severity: 'HIGH'
 * });
 */
class ReviewComment {
  /**
   * @param {Object} data - Comment data
   * @param {string} data.file - File path
   * @param {number} data.line - Line number
   * @param {string} data.message - Comment message
   * @param {string} data.severity - Comment severity (LOW, MEDIUM, HIGH)
   * @param {string} [data.suggestedCode] - Suggested code fix
   */
  constructor(data) {
    this.file = data.file;
    this.line = data.line;
    this.message = data.message;
    this.severity = data.severity || 'LOW';
    this.suggestedCode = data.suggestedCode || null;
  }

  /**
   * Check if comment is high severity
   * @returns {boolean}
   */
  isHighSeverity() {
    return this.severity === 'HIGH';
  }

  /**
   * Check if comment is medium severity
   * @returns {boolean}
   */
  isMediumSeverity() {
    return this.severity === 'MEDIUM';
  }

  /**
   * Check if comment has suggested code
   * @returns {boolean}
   */
  hasSuggestedCode() {
    return this.suggestedCode !== null && this.suggestedCode.length > 0;
  }

  /**
   * Validate comment has required fields
   * @returns {Object} Validation result
   */
  validate() {
    const errors = [];

    if (!this.file || typeof this.file !== 'string') {
      errors.push('file is required and must be a string');
    }

    if (!this.line || typeof this.line !== 'number') {
      errors.push('line is required and must be a number');
    }

    if (!this.message || typeof this.message !== 'string') {
      errors.push('message is required and must be a string');
    }

    if (!['LOW', 'MEDIUM', 'HIGH'].includes(this.severity)) {
      errors.push('severity must be LOW, MEDIUM, or HIGH');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Convert to plain object for serialization
   * @returns {Object} Plain object representation
   */
  toJSON() {
    return {
      file: this.file,
      line: this.line,
      message: this.message,
      severity: this.severity,
      suggestedCode: this.suggestedCode
    };
  }
}

module.exports = ReviewComment;
