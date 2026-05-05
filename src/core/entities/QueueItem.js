/**
 * QueueItem - Individual queue item entity
 *
 * Represents a single review request in the queue with its current status,
 * timestamps, and metadata for tracking through the review lifecycle.
 *
 * @module core/entities/QueueItem
 */

class QueueItem {
  /**
   * Create a new QueueItem
   * @param {Object} data - Item data
   * @param {string} data.id - Unique item identifier (auto-generated if not provided)
   * @param {string} data.instanceKey - GitHub instance key (e.g., 'github/hinha')
   * @param {string} data.repoName - Repository name
   * @param {string} data.prId - Pull request ID (node ID)
   * @param {number} data.prNumber - Pull request number
   * @param {string} data.prTitle - Pull request title
   * @param {string} data.level - Review level (low, medium, high)
   * @param {string} data.status - Current status (queued, processing, completed, failed)
   * @param {string} data.requestedAt - ISO timestamp when requested
   * @param {string} data.startedAt - ISO timestamp when processing started
   * @param {string} data.completedAt - ISO timestamp when completed/failed
   * @param {string} data.error - Error message if failed
   * @param {number} data.retryCount - Number of retry attempts
   */
  constructor(data = {}) {
    this.id = data.id || this._generateId();
    this.instanceKey = data.instanceKey;
    this.repoName = data.repoName;
    this.prId = data.prId;
    this.prNumber = data.prNumber;
    this.prTitle = data.prTitle || '';
    this.level = data.level;
    this.status = data.status || 'queued'; // queued, processing, completed, failed
    this.requestedAt = data.requestedAt || new Date().toISOString();
    this.startedAt = data.startedAt || null;
    this.completedAt = data.completedAt || null;
    this.error = data.error || null;
    this.retryCount = data.retryCount || 0;
  }

  /**
   * Generate unique item ID
   * @private
   * @returns {string} Unique ID
   */
  _generateId() {
    return `qi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Mark item as processing
   */
  markAsProcessing() {
    this.status = 'processing';
    this.startedAt = new Date().toISOString();
  }

  /**
   * Mark item as completed
   */
  markAsCompleted() {
    this.status = 'completed';
    this.completedAt = new Date().toISOString();
  }

  /**
   * Mark item as failed
   * @param {string} error - Error message
   */
  markAsFailed(error) {
    this.status = 'failed';
    this.error = error;
    this.completedAt = new Date().toISOString();
  }

  /**
   * Get processing duration in milliseconds
   * @returns {number|null} Duration in ms, or null if not completed
   */
  getDuration() {
    if (!this.startedAt || !this.completedAt) {
      return null;
    }
    return new Date(this.completedAt).getTime() - new Date(this.startedAt).getTime();
  }

  /**
   * Check if item is in a terminal state
   * @returns {boolean} True if completed or failed
   */
  isTerminal() {
    return this.status === 'completed' || this.status === 'failed';
  }

  /**
   * Serialize to JSON
   * @returns {Object} JSON representation
   */
  toJSON() {
    return {
      id: this.id,
      instanceKey: this.instanceKey,
      repoName: this.repoName,
      prId: this.prId,
      prNumber: this.prNumber,
      prTitle: this.prTitle,
      level: this.level,
      status: this.status,
      requestedAt: this.requestedAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      error: this.error,
      retryCount: this.retryCount
    };
  }

  /**
   * Deserialize from JSON
   * @param {Object} json - JSON representation
   * @returns {QueueItem} QueueItem instance
   */
  static fromJSON(json) {
    return new QueueItem(json);
  }
}

module.exports = QueueItem;
