/**
 * FileChange - Domain entity representing a changed file in a PR
 *
 * @example
 * const fileChange = new FileChange({
 *   filename: 'src/app.js',
 *   additions: 10,
 *   deletions: 5,
 *   changes: 15,
 *   status: 'modified'
 * });
 */
class FileChange {
  /**
   * @param {Object} data - File change data
   * @param {string} data.filename - File path
   * @param {number} data.additions - Lines added
   * @param {number} data.deletions - Lines deleted
   * @param {number} data.changes - Total changes
   * @param {string} data.status - File change status
   */
  constructor(data) {
    this.filename = data.filename;
    this.additions = data.additions || 0;
    this.deletions = data.deletions || 0;
    this.changes = data.changes || 0;
    this.status = data.status || 'modified';
  }

  /**
   * Check if file is a test file
   * @returns {boolean}
   */
  isTestFile() {
    const testPatterns = [
      '_test.go', '_test.js', '_test.ts', '.test.', '/e2e_test/', '/e2e/',
      '/__tests__/', '/test/', '/tests/', '/spec/', '_spec.', '.spec.',
      'swagger.json', 'swagger.yaml', 'swagger.yml',
      'openapi.json', 'openapi.yaml', 'openapi.yml'
    ];
    return testPatterns.some(pattern => this.filename.includes(pattern));
  }

  /**
   * Get file extension
   * @returns {string} File extension (with dot)
   */
  getExtension() {
    const idx = this.filename.lastIndexOf('.');
    return idx >= 0 ? this.filename.substring(idx) : '';
  }

  /**
   * Check if file is modified (not added or deleted)
   * @returns {boolean}
   */
  isModified() {
    return this.status === 'modified';
  }

  /**
   * Check if file is newly added
   * @returns {boolean}
   */
  isAdded() {
    return this.status === 'added';
  }

  /**
   * Check if file is deleted
   * @returns {boolean}
   */
  isDeleted() {
    return this.status === 'deleted';
  }

  /**
   * Get change ratio (additions to deletions)
   * @returns {number} Change ratio
   */
  getChangeRatio() {
    if (this.deletions === 0) return this.additions;
    return this.additions / this.deletions;
  }

  /**
   * Convert to plain object for serialization
   * @returns {Object} Plain object representation
   */
  toJSON() {
    return {
      filename: this.filename,
      additions: this.additions,
      deletions: this.deletions,
      changes: this.changes,
      status: this.status,
      isTestFile: this.isTestFile()
    };
  }
}

module.exports = FileChange;
