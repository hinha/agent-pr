const fs = require('fs/promises');
const path = require('path');
const config = require('../config/yamlConfig');
const logger = require('../utils/logger');

/**
 * Review State Manager - Track PR reviews and detect outdated reviews
 * Maintains state for PRs with REQUEST_CHANGES reviews to detect when
 * new commits are pushed that may address review comments
 */
class ReviewStateManager {
  constructor() {
    this.state = new Map();
    this.loaded = false;
  }

  getRepoKey(owner, repo) {
    return `${owner}/${repo}`;
  }

  getRepoState(owner, repo) {
    const key = this.getRepoKey(owner, repo);

    if (!this.state.has(key)) {
      this.state.set(key, {
        reviews: new Map(),
        loaded: false
      });

      this.loadRepoState(owner, repo).catch(err => {
        logger.error(`Failed to load review state for ${key}: ${err.message}`);
      });
    }

    return this.state.get(key);
  }

  getRepoStorageDir(owner, repo) {
    return config.ensureRepoStorageDir(owner, repo);
  }

  getRepoFilePath(owner, repo, filename) {
    const dir = this.getRepoStorageDir(owner, repo);
    return path.join(dir, filename);
  }

  async loadRepoState(owner, repo) {
    const key = this.getRepoKey(owner, repo);
    const repoState = this.state.get(key);

    if (repoState.loaded) return;

    try {
      const reviewStatePath = this.getRepoFilePath(owner, repo, 'review_state.json');

      const raw = await fs.readFile(reviewStatePath, 'utf8').catch(() => null);

      if (raw) {
        const parsed = JSON.parse(raw);
        Object.entries(parsed).forEach(([prId, state]) => {
          repoState.reviews.set(prId, state);
        });
        logger.debug(`[${key}] Loaded review state for ${repoState.reviews.size} PRs`);
      }

      repoState.loaded = true;
    } catch (err) {
      logger.error(`[${key}] Error loading review state: ${err.message}`);
      repoState.loaded = true;
    }
  }

  async saveRepoState(owner, repo) {
    const key = this.getRepoKey(owner, repo);
    const repoState = this.state.get(key);

    if (!repoState) {
      logger.warn(`[${key}] No review state to save`);
      return;
    }

    try {
      const reviewStatePath = this.getRepoFilePath(owner, repo, 'review_state.json');

      const stateObj = Object.fromEntries(repoState.reviews);
      await fs.writeFile(reviewStatePath, JSON.stringify(stateObj, null, 2));

      logger.debug(`[${key}] Review state saved successfully`);
    } catch (err) {
      logger.error(`[${key}] Failed to save review state: ${err.message}`);
      throw err;
    }
  }

  /**
   * Update review state for a PR based on fetched reviews
   * Returns the review state if there's a REQUEST_CHANGES review, null otherwise
   */
  async updateReviewState(owner, repo, prId, reviews, currentHeadSha) {
    const key = this.getRepoKey(owner, repo);
    const repoState = this.getRepoState(owner, repo);
    const prIdStr = prId.toString();

    const requestedChangesReviews = reviews.filter(r => r.state === 'CHANGES_REQUESTED');

    if (requestedChangesReviews.length === 0) {
      repoState.reviews.delete(prIdStr);
      await this.saveRepoState(owner, repo);
      return null;
    }

    const latestReview = requestedChangesReviews
      .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0];

    // Check if there's an APPROVED review after the latest REQUEST_CHANGES
    const approvedReviews = reviews.filter(r => r.state === 'APPROVED');
    const approvedAfterRequestChanges = approvedReviews.filter(r =>
      new Date(r.submitted_at) > new Date(latestReview.submitted_at)
    );

    if (approvedAfterRequestChanges.length > 0) {
      // PR was approved after the request changes, clear state and skip notification
      repoState.reviews.delete(prIdStr);
      await this.saveRepoState(owner, repo);
      logger.info(`[${key}] PR #${prId} was approved after REQUEST_CHANGES, clearing review state`);
      return null;
    }

    const reviewState = {
      review_id: latestReview.id,
      state: latestReview.state,
      submitted_at: latestReview.submitted_at,
      head_sha: latestReview.head_sha,
      current_head_sha: currentHeadSha,
      has_outdated: true, // Always true for REQUEST_CHANGES reviews
      last_checked: new Date().toISOString(),
      dismissed: false
    };

    repoState.reviews.set(prIdStr, reviewState);
    await this.saveRepoState(owner, repo);

    logger.debug(`[${key}] Updated review state for PR #${prId}: REQUEST_CHANGES review tracked`);

    return reviewState;
  }

  /**
   * Check if PR has new commits since the review
   */
  hasNewCommits(owner, repo, prId, currentHeadSha) {
    const key = this.getRepoKey(owner, repo);
    const repoState = this.getRepoState(owner, repo);
    const prIdStr = prId.toString();

    const reviewState = repoState.reviews.get(prIdStr);

    if (!reviewState) return false;

    const hasNew = reviewState.head_sha !== currentHeadSha;

    if (hasNew) {
      logger.info(`[${key}] PR #${prId} has new commits: ${reviewState.head_sha?.substring(0, 7)} -> ${currentHeadSha.substring(0, 7)}`);
    }

    return hasNew;
  }

  /**
   * Get review state for a specific PR
   */
  getReviewState(owner, repo, prId) {
    const repoState = this.getRepoState(owner, repo);
    return repoState.reviews.get(prId.toString());
  }

  /**
   * Mark a review as dismissed
   */
  async markDismissed(owner, repo, prId) {
    const key = this.getRepoKey(owner, repo);
    const repoState = this.getRepoState(owner, repo);
    const prIdStr = prId.toString();

    if (repoState.reviews.has(prIdStr)) {
      const reviewState = repoState.reviews.get(prIdStr);
      reviewState.dismissed = true;
      reviewState.dismissed_at = new Date().toISOString();
      await this.saveRepoState(owner, repo);
      logger.info(`[${key}] Marked PR #${prId} review as dismissed`);
    }
  }

  /**
   * Clear review state for a PR (e.g., after approving)
   */
  async clearReviewState(owner, repo, prId) {
    const key = this.getRepoKey(owner, repo);
    const repoState = this.getRepoState(owner, repo);
    const prIdStr = prId.toString();

    repoState.reviews.delete(prIdStr);
    await this.saveRepoState(owner, repo);
    logger.info(`[${key}] Cleared review state for PR #${prId}`);
  }

  /**
   * Get PRs needing attention (not dismissed, has outdated, has new commits)
   */
  getPRsNeedingAttention(owner, repo) {
    const repoState = this.getRepoState(owner, repo);
    const results = [];

    for (const [prIdStr, state] of repoState.reviews.entries()) {
      if (!state.dismissed && state.has_outdated) {
        results.push({ prId: parseInt(prIdStr), ...state });
      }
    }

    return results;
  }

  /**
   * Cleanup old entries to prevent unbounded growth
   */
  cleanupOldEntries(owner, repo, maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
    const repoState = this.getRepoState(owner, repo);
    const now = Date.now();
    let cleaned = 0;

    for (const [prIdStr, state] of repoState.reviews.entries()) {
      const checkedAt = new Date(state.last_checked).getTime();
      if ((now - checkedAt) > maxAgeMs) {
        repoState.reviews.delete(prIdStr);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      const key = this.getRepoKey(owner, repo);
      logger.info(`[${key}] Cleaned up ${cleaned} old review entries (older than ${maxAgeMs / 86400000} days)`);
    }

    return cleaned;
  }

  /**
   * Get statistics across all repositories
   */
  getStats() {
    const stats = {
      totalRepos: this.state.size,
      totalReviews: 0,
      totalOutdated: 0,
      totalDismissed: 0
    };

    for (const [key, repoState] of this.state.entries()) {
      stats.totalReviews += repoState.reviews.size;
      for (const state of repoState.reviews.values()) {
        if (state.has_outdated) stats.totalOutdated++;
        if (state.dismissed) stats.totalDismissed++;
      }
    }

    return stats;
  }
}

module.exports = new ReviewStateManager();
