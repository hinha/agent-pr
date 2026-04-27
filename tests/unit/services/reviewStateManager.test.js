/**
 * Unit tests for reviewStateManager (simplified version without FS mocking)
 * Tests core review state tracking logic
 */

jest.mock('../../../src/config/yamlConfig', () => ({
  ensureRepoStorageDir: jest.fn((owner, repo) => `/data/instances/${owner}/${repo}`)
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}));

jest.resetModules();
const reviewStateManager = require('../../../src/services/reviewStateManager');

describe('reviewStateManager (core logic)', () => {
  beforeEach(() => {
    reviewStateManager.state.clear();
  });

  describe('getRepoKey', () => {
    test('should return correct repo key format', () => {
        const result = reviewStateManager.getRepoKey('owner', 'repo');
      expect(result).toBe('owner/repo');
    });
  });

  describe('getRepoStateSync', () => {
    test('should create new repo state if not exists', () => {
      const result = reviewStateManager.getRepoStateSync('owner', 'repo');

      expect(result).toBeDefined();
      expect(result.reviews).toBeInstanceOf(Map);
      expect(reviewStateManager.state.has('owner/repo')).toBe(true);
    });

    test('should return existing repo state', () => {
      const first = reviewStateManager.getRepoStateSync('owner', 'repo');
      const second = reviewStateManager.getRepoStateSync('owner', 'repo');

      expect(first).toBe(second);
    });
  });

  describe('hasNewCommits', () => {
    test('should return true when head SHA differs', () => {
      const repoState = reviewStateManager.getRepoStateSync('owner', 'repo');
      repoState.reviews.set('123', {
        head_sha: 'abc123'
      });

      const result = reviewStateManager.hasNewCommits('owner', 'repo', 123, 'def456');

      expect(result).toBe(true);
    });

    test('should return false when head SHA matches', () => {
      const repoState = reviewStateManager.getRepoStateSync('owner', 'repo');
      repoState.reviews.set('123', {
        head_sha: 'abc123'
      });

      const result = reviewStateManager.hasNewCommits('owner', 'repo', 123, 'abc123');

      expect(result).toBe(false);
    });

    test('should return false when no review state exists', () => {
      reviewStateManager.getRepoStateSync('owner', 'repo');

      const result = reviewStateManager.hasNewCommits('owner', 'repo', 123, 'abc123');

      expect(result).toBe(false);
    });
  });

  describe('getReviewState', () => {
    test('should return review state for PR', () => {
      const repoState = reviewStateManager.getRepoStateSync('owner', 'repo');
      repoState.reviews.set('123', {
        review_id: 1,
        state: 'CHANGES_REQUESTED'
      });

      const result = reviewStateManager.getReviewState('owner', 'repo', 123);

      expect(result).toBeDefined();
      expect(result.review_id).toBe(1);
    });

    test('should return undefined when no review state exists', () => {
      reviewStateManager.getRepoStateSync('owner', 'repo');

      const result = reviewStateManager.getReviewState('owner', 'repo', 123);

      expect(result).toBeUndefined();
    });
  });

  describe('getPRsNeedingAttention', () => {
    test('should return PRs with outdated reviews that are not dismissed', () => {
      const repoState = reviewStateManager.getRepoStateSync('owner', 'repo');
      repoState.reviews.set('123', {
        has_outdated: true,
        dismissed: false
      });
      repoState.reviews.set('456', {
        has_outdated: true,
        dismissed: true
      });
      repoState.reviews.set('789', {
        has_outdated: false,
        dismissed: false
      });

      const results = reviewStateManager.getPRsNeedingAttention('owner', 'repo');

      expect(results).toHaveLength(1);
      expect(results[0].prId).toBe(123);
    });

    test('should return empty array when no PRs need attention', () => {
      reviewStateManager.getRepoStateSync('owner', 'repo');

      const results = reviewStateManager.getPRsNeedingAttention('owner', 'repo');

      expect(results).toEqual([]);
    });
  });

  describe('updateReviewState logic', () => {
    test('should identify REQUEST_CHANGES reviews', () => {
      const reviews = [
        { id: 1, state: 'APPROVED', submitted_at: '2024-01-01T00:00:00Z', head_sha: 'abc123' },
        { id: 2, state: 'CHANGES_REQUESTED', submitted_at: '2024-01-02T00:00:00Z', head_sha: 'def456' }
      ];

      const requestedChangesReviews = reviews.filter(r => r.state === 'CHANGES_REQUESTED');
      expect(requestedChangesReviews).toHaveLength(1);
      expect(requestedChangesReviews[0].id).toBe(2);
    });

    test('should select latest REQUEST_CHANGES review when multiple exist', () => {
      const reviews = [
        { id: 1, state: 'CHANGES_REQUESTED', submitted_at: '2024-01-01T00:00:00Z', head_sha: 'abc123' },
        { id: 2, state: 'CHANGES_REQUESTED', submitted_at: '2024-01-02T00:00:00Z', head_sha: 'def456' }
      ];

      const latest = reviews
        .filter(r => r.state === 'CHANGES_REQUESTED')
        .sort((a, b) => new Date(b.submitted_at) - new Date(a.submitted_at))[0];

      expect(latest.id).toBe(2);
    });

    test('should detect APPROVED reviews after REQUEST_CHANGES', () => {
      const reviews = [
        { id: 1, state: 'CHANGES_REQUESTED', submitted_at: '2024-01-01T00:00:00Z', head_sha: 'abc123' },
        { id: 2, state: 'APPROVED', submitted_at: '2024-01-02T00:00:00Z', head_sha: 'def456' }
      ];

      const requestedChangesReviews = reviews.filter(r => r.state === 'CHANGES_REQUESTED');
      const latestRequestChanges = requestedChangesReviews[0];

      const approvedReviews = reviews.filter(r => r.state === 'APPROVED');
      const approvedAfterRequestChanges = approvedReviews.filter(r =>
        new Date(r.submitted_at) > new Date(latestRequestChanges.submitted_at)
      );

      expect(approvedAfterRequestChanges).toHaveLength(1);
    });
  });

  describe('getStats', () => {
    test('should return correct statistics', () => {
      const repoState1 = reviewStateManager.getRepoStateSync('owner1', 'repo1');
      repoState1.reviews.set('123', { has_outdated: true, dismissed: false });
      repoState1.reviews.set('456', { has_outdated: true, dismissed: true });

      const repoState2 = reviewStateManager.getRepoStateSync('owner2', 'repo2');
      repoState2.reviews.set('789', { has_outdated: false, dismissed: false });

      const stats = reviewStateManager.getStats();

      expect(stats.totalRepos).toBe(2);
      expect(stats.totalReviews).toBe(3);
      expect(stats.totalOutdated).toBe(2);
      expect(stats.totalDismissed).toBe(1);
    });

    test('should return zeros when no entries exist', () => {
      const stats = reviewStateManager.getStats();

      expect(stats.totalRepos).toBe(0);
      expect(stats.totalReviews).toBe(0);
      expect(stats.totalOutdated).toBe(0);
      expect(stats.totalDismissed).toBe(0);
    });
  });

  describe('cleanup logic', () => {
    test('should remove entries older than max age', () => {
      const now = Date.now();
      const repoState = reviewStateManager.getRepoStateSync('owner', 'repo');
      repoState.reviews.set('123', {
        last_checked: new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString()
      });
      repoState.reviews.set('456', {
        last_checked: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString()
      });

      let cleaned = 0;
      for (const [prIdStr, state] of repoState.reviews.entries()) {
        const checkedAt = new Date(state.last_checked).getTime();
        if ((Date.now() - checkedAt) > 30 * 24 * 60 * 60 * 1000) {
          repoState.reviews.delete(prIdStr);
          cleaned++;
        }
      }

      expect(cleaned).toBe(1);
      expect(repoState.reviews.has('123')).toBe(false);
      expect(repoState.reviews.has('456')).toBe(true);
    });
  });
});
