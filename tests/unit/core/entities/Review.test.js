/**
 * Unit tests for Review entity
 */

const Review = require('../../../../src/core/entities/Review');
const ReviewComment = require('../../../../src/core/entities/ReviewComment');

describe('Review Entity', () => {
  describe('constructor', () => {
    it('should create Review with valid data', () => {
      const comment1 = new ReviewComment({
        file: 'test.js',
        line: 10,
        message: 'Bug here',
        severity: 'HIGH'
      });

      const data = {
        id: 123,
        prId: 456,
        state: 'APPROVED',
        comments: [comment1],
        submittedAt: new Date('2024-01-01'),
        summary: 'LGTM',
        submittedBy: 'testuser'
      };

      const review = new Review(data);

      expect(review.id).toBe(123);
      expect(review.prId).toBe(456);
      expect(review.state).toBe('APPROVED');
      expect(review.comments).toHaveLength(1);
    });

    it('should use default values for optional fields', () => {
      const review = new Review({
        prId: 456
      });

      expect(review.id).toBeUndefined();
      expect(review.comments).toEqual([]);
      expect(review.summary).toBeUndefined();
      expect(review.submittedBy).toBeNull();
    });
  });

  describe('isApproved', () => {
    it('should return true for APPROVED state', () => {
      const review = new Review({
        prNumber: 456,
        reviewer: 'testuser',
        state: 'APPROVED'
      });

      expect(review.isApproved()).toBe(true);
    });

    it('should return false for non-approved states', () => {
      const review = new Review({
        prNumber: 456,
        reviewer: 'testuser',
        state: 'CHANGES_REQUESTED'
      });

      expect(review.isApproved()).toBe(false);
    });
  });

  describe('requiresChanges', () => {
    it('should return true when has high severity comments', () => {
      const comments = [
        new ReviewComment({ file: 'a.js', line: 1, message: 'A', severity: 'HIGH' })
      ];

      const review = new Review({
        prId: 456,
        comments
      });

      expect(review.requiresChanges()).toBe(true);
    });

    it('should return false when no high severity comments', () => {
      const comments = [
        new ReviewComment({ file: 'a.js', line: 1, message: 'A', severity: 'LOW' }),
        new ReviewComment({ file: 'b.js', line: 2, message: 'B', severity: 'MEDIUM' })
      ];

      const review = new Review({
        prId: 456,
        comments
      });

      expect(review.requiresChanges()).toBe(false);
    });
  });

  describe('getSeverityBreakdown', () => {
    it('should count comments by severity', () => {
      const comments = [
        new ReviewComment({ file: 'a.js', line: 1, message: 'A', severity: 'HIGH' }),
        new ReviewComment({ file: 'b.js', line: 2, message: 'B', severity: 'HIGH' }),
        new ReviewComment({ file: 'c.js', line: 3, message: 'C', severity: 'MEDIUM' }),
        new ReviewComment({ file: 'd.js', line: 4, message: 'D', severity: 'LOW' })
      ];

      const review = new Review({
        prNumber: 456,
        reviewer: 'testuser',
        comments
      });

      const breakdown = review.getSeverityBreakdown();

      expect(breakdown).toEqual({
        HIGH: 2,
        MEDIUM: 1,
        LOW: 1
      });
    });

    it('should return zeros for review with no comments', () => {
      const review = new Review({
        prNumber: 456,
        reviewer: 'testuser',
        comments: []
      });

      const breakdown = review.getSeverityBreakdown();

      expect(breakdown).toEqual({
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0
      });
    });
  });

  describe('getCommentsCount', () => {
    it('should return total comment count', () => {
      const comments = [
        new ReviewComment({ file: 'a.js', line: 1, message: 'A', severity: 'HIGH' }),
        new ReviewComment({ file: 'b.js', line: 2, message: 'B', severity: 'MEDIUM' }),
        new ReviewComment({ file: 'c.js', line: 3, message: 'C', severity: 'LOW' })
      ];

      const review = new Review({
        prId: 456,
        comments
      });

      expect(review.getCommentsCount()).toBe(3);
    });

    it('should return 0 for review with no comments', () => {
      const review = new Review({
        prId: 456,
        comments: []
      });

      expect(review.getCommentsCount()).toBe(0);
    });
  });

  describe('hasComments', () => {
    it('should return true when review has comments', () => {
      const comments = [
        new ReviewComment({ file: 'a.js', line: 1, message: 'A', severity: 'HIGH' })
      ];

      const review = new Review({
        prNumber: 456,
        reviewer: 'testuser',
        comments
      });

      expect(review.hasComments()).toBe(true);
    });

    it('should return false when review has no comments', () => {
      const review = new Review({
        prNumber: 456,
        reviewer: 'testuser',
        comments: []
      });

      expect(review.hasComments()).toBe(false);
    });
  });

  describe('hasHighSeverityComments', () => {
    it('should return true when review has high severity comments', () => {
      const comments = [
        new ReviewComment({ file: 'a.js', line: 1, message: 'A', severity: 'HIGH' }),
        new ReviewComment({ file: 'b.js', line: 2, message: 'B', severity: 'LOW' })
      ];

      const review = new Review({
        prId: 456,
        comments
      });

      expect(review.getHighSeverityCount()).toBe(1);
    });

    it('should return false when review has no high severity comments', () => {
      const comments = [
        new ReviewComment({ file: 'a.js', line: 1, message: 'A', severity: 'LOW' }),
        new ReviewComment({ file: 'b.js', line: 2, message: 'B', severity: 'MEDIUM' })
      ];

      const review = new Review({
        prId: 456,
        comments
      });

      expect(review.getHighSeverityCount()).toBe(0);
    });
  });

  describe('isChangesRequested', () => {
    it('should return true for REQUEST_CHANGES state', () => {
      const review = new Review({
        prId: 456,
        state: 'REQUEST_CHANGES'
      });

      expect(review.isChangesRequested()).toBe(true);
    });

    it('should return false for other states', () => {
      const review = new Review({
        prId: 456,
        state: 'APPROVED'
      });

      expect(review.isChangesRequested()).toBe(false);
    });
  });

  describe('isDismissed', () => {
    it('should return true for DISMISSED state', () => {
      const review = new Review({
        prId: 456,
        state: 'DISMISSED'
      });

      expect(review.isDismissed()).toBe(true);
    });

    it('should return false for other states', () => {
      const review = new Review({
        prId: 456,
        state: 'APPROVED'
      });

      expect(review.isDismissed()).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should serialize to plain object', () => {
      const comment = new ReviewComment({
        file: 'test.js',
        line: 10,
        message: 'Bug',
        severity: 'HIGH'
      });

      const review = new Review({
        id: 123,
        prId: 456,
        state: 'APPROVED',
        summary: 'LGTM',
        comments: [comment],
        submittedAt: new Date('2024-01-01'),
        submittedBy: 'testuser'
      });

      const json = review.toJSON();

      expect(json).toMatchObject({
        id: 123,
        prId: 456,
        state: 'APPROVED',
        summary: 'LGTM',
        submittedBy: 'testuser'
      });
      expect(json.comments).toHaveLength(1);
      expect(json.submittedAt).toBe('2024-01-01T00:00:00.000Z');
    });
  });

  describe('fromGitHubAPI', () => {
    it('should create Review from GitHub API response', () => {
      const githubReview = {
        id: 123,
        state: 'APPROVED',
        body: 'LGTM',
        user: { login: 'testuser' },
        submitted_at: '2024-01-01T00:00:00Z',
        commit_id: 'abc123'
      };

      const review = Review.fromGitHubAPI(githubReview, 456);

      expect(review.id).toBe(123);
      expect(review.prId).toBe(456);
      expect(review.state).toBe('APPROVED');
      expect(review.summary).toBe('LGTM');
      expect(review.submittedBy).toBe('testuser');
      expect(review.headSha).toBe('abc123');
    });
  });
});
