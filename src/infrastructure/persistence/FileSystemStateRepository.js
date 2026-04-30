const fs = require('fs/promises');
const path = require('path');
const IStateRepository = require('../../interfaces/IStateRepository');

/**
 * FileSystemStateRepository - File-based state persistence
 *
 * This repository implements the IStateRepository interface using the file system
 * for storing PR processing state.
 *
 * @example
 * const repo = new FileSystemStateRepository(owner, repo, logger);
 * await repo.initialize();
 * const processed = await repo.isProcessed(123);
 */
class FileSystemStateRepository extends IStateRepository {
  /**
   * @param {string} owner - Repository owner
   * @param {string} repo - Repository name
   * @param {Object} logger - Winston logger instance
   * @param {string} baseDir - Base directory for state storage
   */
  constructor(owner, repo, logger, baseDir = 'data/instances') {
    super();
    this.owner = owner;
    this.repo = repo;
    this.logger = logger;
    this.baseDir = baseDir;

    // Build storage path
    const instanceKey = `github-${owner}`;
    this.storagePath = path.join(process.cwd(), baseDir, instanceKey, repo);

    // File names
    this.files = {
      processedPRs: 'processed_prs.json',
      notificationCounts: 'notification_counts.json',
      processedTimestamps: 'processed_timestamps.json',
      reviewState: 'review_state.json'
    };

    // In-memory cache
    this.cache = {
      processedPRs: new Set(),
      notificationCounts: new Map(),
      processedTimestamps: new Map(),
      reviewState: new Map(), // prId -> { reviewId, headSha, submittedAt, dismissed }
      outdatedNotified: new Map() // prId -> Set<reviewId> (tracks which outdated reviews were notified)
    };

    this.loaded = false;
  }

  /**
   * Initialize repository for a specific owner/repo
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.loaded) {
      return;
    }

    try {
      // Ensure storage directory exists
      await fs.mkdir(this.storagePath, { recursive: true });

      // Load state from files
      await this._loadState();

      this.loaded = true;
    } catch (error) {
      this.logger.error(`[FileSystemStateRepository:${this.owner}/${this.repo}] Failed to initialize: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check if a PR has been processed
   * @param {string} owner - Repository owner (unused, using instance owner)
   * @param {string} repo - Repository name (unused, using instance repo)
   * @param {number} prId - Pull request ID
   * @returns {Promise<boolean>} True if PR is processed
   */
  async isProcessed(owner, repo, prId) {
    await this.initialize();
    return this.cache.processedPRs.has(prId);
  }

  /**
   * Mark a PR as processed
   * @param {string} owner - Repository owner (unused)
   * @param {string} repo - Repository name (unused)
   * @param {number} prId - Pull request ID
   * @returns {Promise<void>}
   */
  async markProcessed(owner, repo, prId) {
    await this.initialize();

    this.cache.processedPRs.add(prId);
    this.cache.processedTimestamps.set(prId, Date.now());

    await this._persistState();
  }

  /**
   * Get notification count for a PR
   * @param {string} owner - Repository owner (unused)
   * @param {string} repo - Repository name (unused)
   * @param {number} prId - Pull request ID
   * @returns {Promise<number>} Notification count
   */
  async getNotificationCount(owner, repo, prId) {
    await this.initialize();
    // Read directly from file to ensure we get the actual persisted value
    return await this._readNotificationCountFromFile(prId);
  }

  /**
   * Read notification count directly from file (bypasses cache)
   * This ensures we always get the persisted value, not stale cache
   *
   * @param {number|string} prId - Pull request ID
   * @returns {Promise<number>} Notification count from file
   * @private
   */
  async _readNotificationCountFromFile(prId) {
    try {
      const countsPath = path.join(this.storagePath, this.files.notificationCounts);
      const data = await this._readJSONFile(countsPath);

      if (data && typeof data === 'object') {
        // Try both numeric and string keys
        const count = data[prId] !== undefined ? data[prId] : data[String(prId)];
        return count !== undefined ? parseInt(count, 10) : 0;
      }
      return 0;
    } catch (error) {
      // File doesn't exist or error reading
      return 0;
    }
  }

  /**
   * Increment notification count for a PR
   * Note: This method is NOT used - notification count is managed by PRStateMachine
   * which persists through reviewState. Kept for backward compatibility.
   *
   * @param {string} owner - Repository owner (unused)
   * @param {string} repo - Repository name (unused)
   * @param {number} prId - Pull request ID
   * @returns {Promise<number>} New notification count
   */
  async incrementNotificationCount(owner, repo, prId) {
    await this.initialize();

    // Read current count from file
    const currentCount = await this._readNotificationCountFromFile(prId);
    const newCount = currentCount + 1;

    // Persist to file directly
    await this._persistNotificationCount(prId, newCount);

    return newCount;
  }

  /**
   * Get all processed PRs for a repository
   * @param {string} owner - Repository owner (unused)
   * @param {string} repo - Repository name (unused)
   * @returns {Promise<Array<number>>} Array of processed PR IDs
   */
  async getProcessedPRs(owner, repo) {
    await this.initialize();
    return Array.from(this.cache.processedPRs);
  }

  /**
   * Clear all processed PRs for a repository
   * @param {string} owner - Repository owner (unused)
   * @param {string} repo - Repository name (unused)
   * @returns {Promise<void>}
   */
  async clearProcessedPRs(owner, repo) {
    await this.initialize();

    this.cache.processedPRs.clear();
    // Do NOT clear notificationCounts from cache - it's not used anymore
    this.cache.processedTimestamps.clear();

    await this._persistState();
  }

  /**
   * Get repository statistics
   * Note: totalNotifications is read directly from file, not cache
   * @returns {Promise<RepositoryStats>} Statistics object
   */
  async getStats() {
    await this.initialize();

    // Calculate total notifications by reading from file
    let totalNotifications = 0;
    try {
      const countsPath = path.join(this.storagePath, this.files.notificationCounts);
      const countsData = await this._readJSONFile(countsPath);
      if (countsData && typeof countsData === 'object') {
        totalNotifications = Object.values(countsData).reduce((sum, count) => sum + (parseInt(count, 10) || 0), 0);
      }
    } catch (error) {
      // Ignore errors, default to 0
    }

    return {
      totalRepos: 1,
      totalProcessedPRs: this.cache.processedPRs.size,
      totalNotifications
    };
  }

  /**
   * Clean up resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    this.logger.debug(`[FileSystemStateRepository:${this.owner}/${this.repo}] Cleaning up...`);
    this.cache.processedPRs.clear();
    // Do NOT clear notificationCounts from cache - it's not used anymore
    this.cache.processedTimestamps.clear();
    this.cache.reviewState.clear();
    this.cache.outdatedNotified.clear();
    this.loaded = false;
  }

  // ===== Review State Management =====

  /**
   * Save review state for a PR
   *
   * @param {string} owner - Repository owner (unused, using instance owner)
   * @param {string} repo - Repository name (unused, using instance repo)
   * @param {string} prId - Pull request ID
   * @param {Object} reviewState - Review state to save
   * @param {string} reviewState.reviewId - Review ID
   * @param {string} reviewState.headSha - Head SHA at time of review
   * @param {string} reviewState.submittedAt - ISO timestamp of submission
   * @param {boolean} reviewState.dismissed - Whether review was dismissed
   * @returns {Promise<void>}
   */
  async saveReviewState(owner, repo, prId, reviewState) {
    await this.initialize();
    // Convert prId to number for consistency (cache uses numeric keys)
    this.cache.reviewState.set(parseInt(prId, 10), reviewState);
    await this._persistState();
  }

  /**
   * Get review state for a PR
   *
   * @param {string} owner - Repository owner (unused)
   * @param {string} repo - Repository name (unused)
   * @param {string} prId - Pull request ID
   * @returns {Promise<Object|null>} Review state or null
   */
  async getReviewState(owner, repo, prId) {
    await this.initialize();
    // Convert prId to number for consistency (cache uses numeric keys)
    return this.cache.reviewState.get(parseInt(prId, 10)) || null;
  }

  /**
   * Clear review state for a PR
   *
   * @param {string} owner - Repository owner (unused)
   * @param {string} repo - Repository name (unused)
   * @param {string} prId - Pull request ID
   * @returns {Promise<void>}
   */
  async clearReviewState(owner, repo, prId) {
    await this.initialize();
    // Convert prId to number for consistency (cache uses numeric keys)
    const numericPrId = parseInt(prId, 10);
    this.cache.reviewState.delete(numericPrId);
    this.cache.outdatedNotified.delete(prId);
    await this._persistState();
  }

  /**
   * Mark that an outdated review notification was sent
   *
   * @param {string} owner - Repository owner (unused)
   * @param {string} repo - Repository name (unused)
   * @param {string} prId - Pull request ID
   * @param {string} reviewId - Review ID that was notified as outdated
   * @returns {Promise<void>}
   */
  async markOutdatedNotified(owner, repo, prId, reviewId) {
    await this.initialize();
    // Get or create Set for this PR
    let reviewIdSet = this.cache.outdatedNotified.get(prId);
    if (!reviewIdSet) {
      reviewIdSet = new Set();
      this.cache.outdatedNotified.set(prId, reviewIdSet);
    }
    // Add reviewId to the Set
    reviewIdSet.add(reviewId);
    await this._persistState();
  }

  /**
   * Check if an outdated review was already notified
   *
   * @param {string} owner - Repository owner (unused)
   * @param {string} repo - Repository name (unused)
   * @param {string} prId - Pull request ID
   * @param {string} reviewId - Review ID to check
   * @returns {Promise<boolean>} True if already notified
   */
  async isOutdatedNotified(owner, repo, prId, reviewId) {
    await this.initialize();
    const reviewIdSet = this.cache.outdatedNotified.get(prId);
    return reviewIdSet ? reviewIdSet.has(reviewId) : false;
  }

  /**
   * Clear outdated review notification for a PR
   *
   * @param {string} owner - Repository owner (unused, using instance owner)
   * @param {string} repo - Repository name (unused, using instance repo)
   * @param {string} prId - Pull request ID
   * @returns {Promise<void>}
   */
  async clearOutdatedNotified(owner, repo, prId) {
    await this.initialize();

    this.cache.outdatedNotified.delete(prId);
    await this._persistState();

    this.logger.debug(
      `[FileSystemStateRepository:${this.owner}/${this.repo}] Cleared outdated notification for PR #${prId}`
    );
  }

  // ===== Private Methods =====

  /**
   * Load state from files
   * @returns {Promise<void>}
   * @private
   */
  async _loadState() {
    try {
      // Load processed PRs
      const processedPath = path.join(this.storagePath, this.files.processedPRs);
      const processedData = await this._readJSONFile(processedPath);
      if (processedData && Array.isArray(processedData.processed)) {
        this.cache.processedPRs = new Set(processedData.processed);
      }

      // Do NOT load notification counts into cache - read directly from file when needed
      // This ensures the file is the single source of truth

      // Load processed timestamps
      const timestampsPath = path.join(this.storagePath, this.files.processedTimestamps);
      const timestampsData = await this._readJSONFile(timestampsPath);
      if (timestampsData && typeof timestampsData === 'object') {
        this.cache.processedTimestamps = new Map(Object.entries(timestampsData).map(([k, v]) => [parseInt(k, 10), v]));
      }

      // Load review state
      const reviewStatePath = path.join(this.storagePath, this.files.reviewState);
      const reviewStateData = await this._readJSONFile(reviewStatePath);
      if (reviewStateData && typeof reviewStateData === 'object') {
        // Load reviews - convert string keys to numeric for consistency
        if (reviewStateData.reviews && typeof reviewStateData.reviews === 'object') {
          this.cache.reviewState = new Map(Object.entries(reviewStateData.reviews).map(([k, v]) => [parseInt(k, 10), v]));
        }
        // Load outdated notified - each value is an array that should be converted to Set
        if (reviewStateData.outdatedNotified && typeof reviewStateData.outdatedNotified === 'object') {
          const outdatedMap = new Map();
          for (const [prId, reviewIds] of Object.entries(reviewStateData.outdatedNotified)) {
            // Convert array to Set
            outdatedMap.set(prId, new Set(reviewIds || []));
          }
          this.cache.outdatedNotified = outdatedMap;
        }
      }

      this.logger.debug(`[FileSystemStateRepository:${this.owner}/${this.repo}] State loaded: ${this.cache.processedPRs.size} processed PRs, ${this.cache.reviewState.size} review states`);
    } catch (error) {
      this.logger.warn(`[FileSystemStateRepository:${this.owner}/${this.repo}] Failed to load state: ${error.message}`);
    }
  }

  /**
   * Persist state to files
   * @returns {Promise<void>}
   * @private
   */
  async _persistState() {
    try {
      // Save processed PRs
      const processedPath = path.join(this.storagePath, this.files.processedPRs);
      await this._writeJSONFile(processedPath, {
        processed: Array.from(this.cache.processedPRs),
        updated: new Date().toISOString()
      });

      // Notification counts are saved by _persistNotificationCount() directly
      // Do NOT write from cache here since cache is no longer used for notification counts

      // Save processed timestamps
      const timestampsPath = path.join(this.storagePath, this.files.processedTimestamps);
      const timestampsObj = {};
      for (const [prId, timestamp] of this.cache.processedTimestamps.entries()) {
        timestampsObj[prId] = timestamp;
      }
      await this._writeJSONFile(timestampsPath, timestampsObj);

      // Save review state
      const reviewStatePath = path.join(this.storagePath, this.files.reviewState);
      // Convert Sets to arrays for JSON serialization
      const outdatedNotifiedObj = {};
      for (const [prId, reviewIdSet] of this.cache.outdatedNotified.entries()) {
        outdatedNotifiedObj[prId] = Array.from(reviewIdSet);
      }
      const reviewStateObj = {
        reviews: Object.fromEntries(this.cache.reviewState),
        outdatedNotified: outdatedNotifiedObj
      };
      await this._writeJSONFile(reviewStatePath, reviewStateObj);

      this.logger.debug(`[FileSystemStateRepository:${this.owner}/${this.repo}] State persisted`);
    } catch (error) {
      this.logger.error(`[FileSystemStateRepository:${this.owner}/${this.repo}] Failed to persist state: ${error.message}`);
      throw error;
    }
  }

  /**
   * Read JSON file safely
   * @param {string} filePath - File path
   * @returns {Promise<any|null>} Parsed object or null
   * @private
   */
  async _readJSONFile(filePath) {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.warn(`[FileSystemStateRepository:${this.owner}/${this.repo}] Failed to read ${filePath}: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Persist notification count to notification_counts.json
   * Note: Does NOT update cache - reads are done directly from file
   *
   * @param {number} prId - Pull request ID
   * @param {number} count - Notification count
   * @returns {Promise<void>}
   * @private
   */
  async _persistNotificationCount(prId, count) {
    try {
      const countsPath = path.join(this.storagePath, this.files.notificationCounts);

      // Read existing counts
      let countsObj = {};
      try {
        const data = await fs.readFile(countsPath, 'utf8');
        countsObj = JSON.parse(data);
      } catch (error) {
        // File doesn't exist yet, start with empty object
      }

      // Update the count for this PR
      countsObj[prId] = count;

      // Write back to file
      await this._writeJSONFile(countsPath, countsObj);

      // Do NOT update cache - reads are done directly from file now
      // this.cache.notificationCounts.set(prId, count);
    } catch (error) {
      this.logger.error(`[FileSystemStateRepository:${this.owner}/${this.repo}] Failed to persist notification count for PR #${prId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Write JSON file safely
   * @param {string} filePath - File path
   * @param {Object} data - Data to write
   * @returns {Promise<void>}
   * @private
   */
  async _writeJSONFile(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  }
}

module.exports = FileSystemStateRepository;
