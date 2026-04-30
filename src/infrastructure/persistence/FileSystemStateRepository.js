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
      outdatedNotified: new Map() // prId -> reviewId (tracks which outdated reviews were notified)
    };

    this.loaded = false;
  }

  /**
   * Initialize repository for a specific owner/repo
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.loaded) {
      this.logger.debug(`[FileSystemStateRepository:${this.owner}/${this.repo}] Already initialized`);
      return;
    }

    this.logger.info(`[FileSystemStateRepository:${this.owner}/${this.repo}] Initializing...`);
    this.logger.info(`[FileSystemStateRepository:${this.owner}/${this.repo}] Storage path: ${this.storagePath}`);

    try {
      // Ensure storage directory exists
      this.logger.info(`[FileSystemStateRepository:${this.owner}/${this.repo}] Creating storage directory...`);
      await fs.mkdir(this.storagePath, { recursive: true });
      this.logger.info(`[FileSystemStateRepository:${this.owner}/${this.repo}] ✓ Storage directory created`);

      // Load state from files
      this.logger.info(`[FileSystemStateRepository:${this.owner}/${this.repo}] Loading existing state...`);
      await this._loadState();
      this.logger.info(`[FileSystemStateRepository:${this.owner}/${this.repo}] ✓ State loaded: ${this.cache.processedPRs.size} processed PRs, ${this.cache.notificationCounts.size} notification counts`);

      this.loaded = true;
      this.logger.info(`[FileSystemStateRepository:${this.owner}/${this.repo}] ✓ Initialization complete`);
    } catch (error) {
      this.logger.error(`[FileSystemStateRepository:${this.owner}/${this.repo}] Failed to initialize: ${error.message}`);
      this.logger.error(`[FileSystemStateRepository:${this.owner}/${this.repo}] Error stack: ${error.stack}`);
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
    this.logger.info(`[FileSystemStateRepository:${this.owner}/${this.repo}] markProcessed() called for PR #${prId}`);
    await this.initialize();

    this.cache.processedPRs.add(prId);
    this.cache.processedTimestamps.set(prId, Date.now());

    this.logger.info(`[FileSystemStateRepository:${this.owner}/${this.repo}] Saving state for PR #${prId}...`);
    await this._persistState();
    this.logger.info(`[FileSystemStateRepository:${this.owner}/${this.repo}] ✓ State saved for PR #${prId}`);
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
    return this.cache.notificationCounts.get(prId) || 0;
  }

  /**
   * Increment notification count for a PR
   * @param {string} owner - Repository owner (unused)
   * @param {string} repo - Repository name (unused)
   * @param {number} prId - Pull request ID
   * @returns {Promise<number>} New notification count
   */
  async incrementNotificationCount(owner, repo, prId) {
    this.logger.info(`[FileSystemStateRepository:${this.owner}/${this.repo}] incrementNotificationCount() called for PR #${prId}`);
    await this.initialize();

    const currentCount = this.cache.notificationCounts.get(prId) || 0;
    const newCount = currentCount + 1;
    this.cache.notificationCounts.set(prId, newCount);

    this.logger.info(`[FileSystemStateRepository:${this.owner}/${this.repo}] Saving notification count for PR #${prId}: ${currentCount} -> ${newCount}`);
    await this._persistState();
    this.logger.info(`[FileSystemStateRepository:${this.owner}/${this.repo}] ✓ Notification count saved for PR #${prId}`);

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
    this.cache.notificationCounts.clear();
    this.cache.processedTimestamps.clear();

    await this._persistState();
  }

  /**
   * Get repository statistics
   * @returns {Promise<RepositoryStats>} Statistics object
   */
  async getStats() {
    await this.initialize();

    return {
      totalRepos: 1,
      totalProcessedPRs: this.cache.processedPRs.size,
      totalNotifications: Array.from(this.cache.notificationCounts.values()).reduce((sum, count) => sum + count, 0)
    };
  }

  /**
   * Clean up resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    this.logger.debug(`[FileSystemStateRepository:${this.owner}/${this.repo}] Cleaning up...`);
    this.cache.processedPRs.clear();
    this.cache.notificationCounts.clear();
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
    this.cache.reviewState.set(prId, reviewState);
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
    return this.cache.reviewState.get(prId) || null;
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
    this.cache.reviewState.delete(prId);
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
    this.cache.outdatedNotified.set(prId, reviewId);
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
    const notifiedReviewId = this.cache.outdatedNotified.get(prId);
    return notifiedReviewId === reviewId;
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

      // Load notification counts
      const countsPath = path.join(this.storagePath, this.files.notificationCounts);
      const countsData = await this._readJSONFile(countsPath);
      if (countsData && typeof countsData === 'object') {
        this.cache.notificationCounts = new Map(Object.entries(countsData).map(([k, v]) => [parseInt(k, 10), v]));
      }

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
        // Load reviews
        if (reviewStateData.reviews && typeof reviewStateData.reviews === 'object') {
          this.cache.reviewState = new Map(Object.entries(reviewStateData.reviews));
        }
        // Load outdated notified
        if (reviewStateData.outdatedNotified && typeof reviewStateData.outdatedNotified === 'object') {
          this.cache.outdatedNotified = new Map(Object.entries(reviewStateData.outdatedNotified));
        }
      }

      this.logger.debug(`[FileSystemStateRepository:${this.owner}/${this.repo}] State loaded: ${this.cache.processedPRs.size} processed PRs, ${this.cache.notificationCounts.size} notification counts, ${this.cache.reviewState.size} review states`);
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

      // Save notification counts
      const countsPath = path.join(this.storagePath, this.files.notificationCounts);
      const countsObj = {};
      for (const [prId, count] of this.cache.notificationCounts.entries()) {
        countsObj[prId] = count;
      }
      await this._writeJSONFile(countsPath, countsObj);

      // Save processed timestamps
      const timestampsPath = path.join(this.storagePath, this.files.processedTimestamps);
      const timestampsObj = {};
      for (const [prId, timestamp] of this.cache.processedTimestamps.entries()) {
        timestampsObj[prId] = timestamp;
      }
      await this._writeJSONFile(timestampsPath, timestampsObj);

      // Save review state
      const reviewStatePath = path.join(this.storagePath, this.files.reviewState);
      const reviewStateObj = {
        reviews: Object.fromEntries(this.cache.reviewState),
        outdatedNotified: Object.fromEntries(this.cache.outdatedNotified)
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
