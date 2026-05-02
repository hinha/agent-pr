/**
 * Unit tests for PullRequest entity
 */

const PullRequest = require('../../../../src/core/entities/PullRequest');

describe('PullRequest Entity', () => {
  describe('constructor', () => {
    it('should create PullRequest with valid data', () => {
      const data = {
        id: 123,
        number: 456,
        title: 'Test PR',
        description: 'Test description',
        author: 'testuser',
        headBranch: 'feature-branch',
        baseBranch: 'main',
        owner: 'testowner',
        repo: 'testrepo',
        createdAt: new Date('2024-01-01')
      };

      const pr = new PullRequest(data);

      expect(pr.id).toBe(123);
      expect(pr.number).toBe(456);
      expect(pr.title).toBe('Test PR');
      expect(pr.author).toBe('testuser');
      expect(pr.description).toBe('Test description');
      expect(pr.headBranch).toBe('feature-branch');
      expect(pr.baseBranch).toBe('main');
    });

    it('should use default values for optional fields', () => {
      const pr = new PullRequest({
        id: 1,
        number: 1,
        title: 'Test',
        owner: 'owner',
        repo: 'repo',
        createdAt: new Date()
      });

      expect(pr.description).toBe('');
      expect(pr.files).toEqual([]);
    });
  });

  describe('fromGitHubAPI', () => {
    it('should create PullRequest from GitHub API response', () => {
      const githubData = {
        id: 123,
        number: 456,
        title: 'GitHub PR',
        body: 'Description',
        user: { login: 'githubuser' },
        head: { ref: 'feature', sha: 'abc123' },
        base: { ref: 'main' },
        html_url: 'https://github.com/owner/repo/pull/456',
        created_at: '2024-01-01T00:00:00Z'
      };

      const pr = PullRequest.fromGitHubAPI(githubData, 'owner', 'repo');

      expect(pr.number).toBe(456);
      expect(pr.title).toBe('GitHub PR');
      expect(pr.author).toBe('githubuser');
      expect(pr.headBranch).toBe('feature');
      expect(pr.baseBranch).toBe('main');
      expect(pr.headSha).toBe('abc123');
      expect(pr.createdAt).toBeInstanceOf(Date);
      expect(pr.owner).toBe('owner');
      expect(pr.repo).toBe('repo');
    });

    it('should handle missing optional fields', () => {
      const githubData = {
        id: 123,
        number: 456,
        title: 'Minimal PR',
        user: { login: 'user' },
        head: { ref: 'branch', sha: 'def456' },
        base: { ref: 'main' },
        created_at: '2024-01-01T00:00:00Z'
      };

      const pr = PullRequest.fromGitHubAPI(githubData, 'owner', 'repo');

      expect(pr.description).toBe('');
      expect(pr.url).toBeUndefined();
    });
  });

  describe('getAgeInHours', () => {
    it('should calculate age correctly for recent PR', () => {
      const createdAt = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago
      const pr = new PullRequest({
        id: 1,
        number: 1,
        title: 'Test',
        owner: 'owner',
        repo: 'repo',
        createdAt
      });

      expect(pr.getAgeInHours()).toBe(2);
    });

    it('should return negative value for future dates', () => {
      const createdAt = new Date(Date.now() + 3600000); // 1 hour in future
      const pr = new PullRequest({
        id: 1,
        number: 1,
        title: 'Test',
        owner: 'owner',
        repo: 'repo',
        createdAt
      });

      // Implementation returns negative value for future dates
      expect(pr.getAgeInHours()).toBeLessThan(0);
    });
  });

  describe('isOlderThan', () => {
    it('should return true for PR older than threshold', () => {
      const createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000); // 25 hours ago
      const pr = new PullRequest({
        id: 1,
        number: 1,
        title: 'Test',
        owner: 'owner',
        repo: 'repo',
        createdAt
      });

      expect(pr.isOlderThan(24)).toBe(true);
    });

    it('should return false for PR within threshold', () => {
      const createdAt = new Date(Date.now() - 10 * 60 * 60 * 1000); // 10 hours ago
      const pr = new PullRequest({
        id: 1,
        number: 1,
        title: 'Test',
        owner: 'owner',
        repo: 'repo',
        createdAt
      });

      expect(pr.isOlderThan(24)).toBe(false);
    });
  });

  describe('getType', () => {
    it('should detect bugfix type', () => {
      const pr = new PullRequest({
        id: 1,
        number: 1,
        title: 'fix: bug in authentication',
        owner: 'owner',
        repo: 'repo',
        createdAt: new Date()
      });

      expect(pr.getType()).toBe('bugfix');
    });

    it('should detect feature type', () => {
      const pr = new PullRequest({
        id: 1,
        number: 1,
        title: 'feat: add new feature',
        owner: 'owner',
        repo: 'repo',
        createdAt: new Date()
      });

      expect(pr.getType()).toBe('feature');
    });

    it('should return other for unknown types', () => {
      const pr = new PullRequest({
        id: 1,
        number: 1,
        title: 'docs: update readme',
        owner: 'owner',
        repo: 'repo',
        createdAt: new Date()
      });

      expect(pr.getType()).toBe('other');
    });
  });

  describe('type checkers', () => {
    it('should identify fix PRs', () => {
      const pr = new PullRequest({
        id: 1,
        number: 1,
        title: 'fix: authentication bug',
        owner: 'owner',
        repo: 'repo',
        createdAt: new Date()
      });

      expect(pr.isFix()).toBe(true);
      expect(pr.isFeature()).toBe(false);
    });

    it('should identify feature PRs', () => {
      const pr = new PullRequest({
        id: 1,
        number: 1,
        title: 'feat: user dashboard',
        owner: 'owner',
        repo: 'repo',
        createdAt: new Date()
      });

      expect(pr.isFeature()).toBe(true);
      expect(pr.isFix()).toBe(false);
    });
  });

  describe('getIdentifier', () => {
    it('should return unique identifier', () => {
      const pr = new PullRequest({
        id: 1,
        number: 123,
        title: 'Test',
        owner: 'testowner',
        repo: 'testrepo',
        createdAt: new Date()
      });

      expect(pr.getIdentifier()).toBe('testowner/testrepo/123');
    });
  });

  describe('toDisplayString', () => {
    it('should format PR as display string', () => {
      const pr = new PullRequest({
        id: 1,
        number: 123,
        title: 'Test PR',
        owner: 'testowner',
        repo: 'testrepo',
        createdAt: new Date('2024-01-01T10:00:00Z')
      });

      const display = pr.toDisplayString();
      expect(display).toContain('#123');
      expect(display).toContain('testowner');
      expect(display).toContain('testrepo');
    });
  });

  describe('toJSON', () => {
    it('should serialize to plain object', () => {
      const pr = new PullRequest({
        id: 123,
        number: 456,
        title: 'Test PR',
        author: 'testuser',
        owner: 'owner',
        repo: 'repo',
        createdAt: new Date('2024-01-01')
      });

      const json = pr.toJSON();

      expect(json).toMatchObject({
        id: 123,
        number: 456,
        title: 'Test PR',
        author: 'testuser'
      });
      expect(json.createdAt).toBe('2024-01-01T00:00:00.000Z');
    });
  });
});
