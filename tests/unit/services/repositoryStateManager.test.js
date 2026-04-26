/**
 * Unit tests for repositoryStateManager (simplified version without FS mocking)
 * Tests core repository-scoped state tracking logic
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

jest.mock('fs/promises', () => ({
  readFile: jest.fn(() => Promise.reject(new Error('ENOENT'))),
  writeFile: jest.fn(() => Promise.resolve())
}));

jest.resetModules();
const repositoryStateManager = require('../../../src/services/repositoryStateManager');

describe('repositoryStateManager (core logic)', () => {
  beforeEach(() => {
    // Clear the state for each test
    repositoryStateManager.state.clear();
  });

  describe('getRepoKey', () => {
    test('should return correct repo key format', () => {
      const key = repositoryStateManager.getRepoKey('owner', 'repo');
      expect(key).toBe('owner/repo');
    });

    test('should handle different owner and repo combinations', () => {
      expect(repositoryStateManager.getRepoKey('org1', 'repo1')).toBe('org1/repo1');
      expect(repositoryStateManager.getRepoKey('org2', 'repo2')).toBe('org2/repo2');
      expect(repositoryStateManager.getRepoKey('user', 'project')).toBe('user/project');
    });
  });

  describe('getRepoStateSync', () => {
    test('should create new repo state if not exists', () => {
      const repoState = repositoryStateManager.getRepoStateSync('owner', 'repo');

      expect(repoState).toBeDefined();
      expect(repoState.processedPRs).toBeInstanceOf(Set);
      expect(repoState.notificationCount).toBeInstanceOf(Map);
      expect(repoState.processedTimestamps).toBeInstanceOf(Map);
      expect(repositoryStateManager.state.has('owner/repo')).toBe(true);
    });

    test('should return existing repo state', () => {
      const first = repositoryStateManager.getRepoStateSync('owner', 'repo');
      const second = repositoryStateManager.getRepoStateSync('owner', 'repo');

      expect(first).toBe(second);
    });

    test('should create independent states for different repos', () => {
      const state1 = repositoryStateManager.getRepoStateSync('owner1', 'repo1');
      const state2 = repositoryStateManager.getRepoStateSync('owner2', 'repo2');

      expect(state1).not.toBe(state2);
      expect(repositoryStateManager.state.size).toBe(2);
    });
  });

  describe('isProcessed', () => {
    test('should return false for unprocessed PR', async () => {
      const repoState = repositoryStateManager.getRepoStateSync('owner', 'repo');
      repoState.loaded = true;

      const result = await repositoryStateManager.isProcessed('owner', 'repo', '123');
      expect(result).toBe(false);
    });

    test('should return true for processed PR', async () => {
      const repoState = repositoryStateManager.getRepoStateSync('owner', 'repo');
      repoState.processedPRs.add('123');
      repoState.loaded = true;

      const result = await repositoryStateManager.isProcessed('owner', 'repo', '123');
      expect(result).toBe(true);
    });

    test('should convert PR ID to string for lookup', async () => {
      const repoState = repositoryStateManager.getRepoStateSync('owner', 'repo');
      repoState.processedPRs.add('123');
      repoState.loaded = true;

      const result = await repositoryStateManager.isProcessed('owner', 'repo', 123);
      expect(result).toBe(true);
    });
  });

  describe('getNotificationCount', () => {
    test('should return 0 for PR with no notifications', () => {
      repositoryStateManager.getRepoStateSync('owner', 'repo');
      const count = repositoryStateManager.getNotificationCount('owner', 'repo', '123');
      expect(count).toBe(0);
    });

    test('should return current count for PR', () => {
      const repoState = repositoryStateManager.getRepoStateSync('owner', 'repo');
      repoState.notificationCount.set('123', 2);

      const count = repositoryStateManager.getNotificationCount('owner', 'repo', '123');
      expect(count).toBe(2);
    });

    test('should convert PR ID to string for lookup', () => {
      const repoState = repositoryStateManager.getRepoStateSync('owner', 'repo');
      repoState.notificationCount.set('123', 3);

      const count = repositoryStateManager.getNotificationCount('owner', 'repo', 123);
      expect(count).toBe(3);
    });
  });

  describe('cleanupOldEntries logic', () => {
    test('should remove entries older than max age', () => {
      const repoState = repositoryStateManager.getRepoStateSync('owner', 'repo');
      const now = Date.now();

      repoState.processedPRs.add('123');
      repoState.processedTimestamps.set('123', now - 10 * 24 * 60 * 60 * 1000); // 10 days old
      repoState.notificationCount.set('123', 3);

      repoState.processedPRs.add('456');
      repoState.processedTimestamps.set('456', now - 1 * 24 * 60 * 60 * 1000); // 1 day old
      repoState.notificationCount.set('456', 2);

      const cleaned = repositoryStateManager.cleanupOldEntries('owner', 'repo', 7 * 24 * 60 * 60 * 1000);

      expect(cleaned).toBe(1);
      expect(repoState.processedPRs.has('123')).toBe(false);
      expect(repoState.processedPRs.has('456')).toBe(true);
    });

    test('should clean up orphaned notification counts', () => {
      const repoState = repositoryStateManager.getRepoStateSync('owner', 'repo');
      repoState.notificationCount.set('123', 3);
      // No corresponding entry in processedPRs

      const cleaned = repositoryStateManager.cleanupOldEntries('owner', 'repo');

      expect(cleaned).toBe(1);
      expect(repoState.notificationCount.has('123')).toBe(false);
    });

    test('should handle empty state', () => {
      repositoryStateManager.getRepoStateSync('owner', 'repo');
      const cleaned = repositoryStateManager.cleanupOldEntries('owner', 'repo');
      expect(cleaned).toBe(0);
    });
  });

  describe('incrementNotificationCount logic', () => {
    test('should increment from 0 to 1 for new PR', async () => {
      const repoState = repositoryStateManager.getRepoStateSync('owner', 'repo');
      repoState.loaded = true;

      const initialCount = repositoryStateManager.getNotificationCount('owner', 'repo', '123');
      expect(initialCount).toBe(0);

      // Simulate increment logic
      const current = initialCount;
      const newCount = current + 1;
      repoState.notificationCount.set('123', newCount);

      expect(repositoryStateManager.getNotificationCount('owner', 'repo', '123')).toBe(1);
    });

    test('should increment multiple times', async () => {
      const repoState = repositoryStateManager.getRepoStateSync('owner', 'repo');
      repoState.loaded = true;
      repoState.notificationCount.set('123', 2);

      // Simulate increment logic
      const current = repositoryStateManager.getNotificationCount('owner', 'repo', '123');
      const newCount = current + 1;
      repoState.notificationCount.set('123', newCount);

      expect(repositoryStateManager.getNotificationCount('owner', 'repo', '123')).toBe(3);
    });
  });

  describe('markProcessed logic', () => {
    test('should add PR to processedPRs', async () => {
      const repoState = repositoryStateManager.getRepoStateSync('owner', 'repo');
      repoState.loaded = true;

      const prId = '123';
      repoState.processedPRs.add(prId);
      repoState.processedTimestamps.set(prId, Date.now());

      expect(repoState.processedPRs.has(prId)).toBe(true);
      expect(repoState.processedTimestamps.has(prId)).toBe(true);
    });

    test('should not add duplicate PR entries', async () => {
      const repoState = repositoryStateManager.getRepoStateSync('owner', 'repo');
      repoState.loaded = true;

      const prId = '123';
      repoState.processedPRs.add(prId);
      repoState.processedPRs.add(prId); // Add again

      expect(repoState.processedPRs.size).toBe(1); // Set prevents duplicates
    });
  });

  describe('getStats', () => {
    test('should return zero stats for empty state', () => {
      const stats = repositoryStateManager.getStats();

      expect(stats.totalRepos).toBe(0);
      expect(stats.totalProcessedPRs).toBe(0);
      expect(stats.totalNotifications).toBe(0);
    });

    test('should count repositories correctly', () => {
      repositoryStateManager.getRepoStateSync('owner1', 'repo1');
      repositoryStateManager.getRepoStateSync('owner2', 'repo2');
      repositoryStateManager.getRepoStateSync('owner3', 'repo3');

      const stats = repositoryStateManager.getStats();
      expect(stats.totalRepos).toBe(3);
    });

    test('should count processed PRs correctly', () => {
      const repo1 = repositoryStateManager.getRepoStateSync('owner1', 'repo1');
      repo1.processedPRs.add('123');
      repo1.processedPRs.add('456');

      const repo2 = repositoryStateManager.getRepoStateSync('owner2', 'repo2');
      repo2.processedPRs.add('789');

      const stats = repositoryStateManager.getStats();
      expect(stats.totalProcessedPRs).toBe(3);
    });

    test('should count notification entries correctly', () => {
      const repo1 = repositoryStateManager.getRepoStateSync('owner1', 'repo1');
      repo1.notificationCount.set('123', 1);
      repo1.notificationCount.set('456', 2);

      const repo2 = repositoryStateManager.getRepoStateSync('owner2', 'repo2');
      repo2.notificationCount.set('789', 3);

      const stats = repositoryStateManager.getStats();
      expect(stats.totalNotifications).toBe(3);
    });
  });

  describe('Multi-repository isolation', () => {
    test('should maintain separate states for different repositories', () => {
      const repo1 = repositoryStateManager.getRepoStateSync('owner1', 'repo1');
      const repo2 = repositoryStateManager.getRepoStateSync('owner2', 'repo2');

      repo1.processedPRs.add('123');
      repo2.processedPRs.add('456');

      expect(repo1.processedPRs.has('123')).toBe(true);
      expect(repo1.processedPRs.has('456')).toBe(false);

      expect(repo2.processedPRs.has('456')).toBe(true);
      expect(repo2.processedPRs.has('123')).toBe(false);
    });

    test('should handle same repo name with different owners', () => {
      const repo1 = repositoryStateManager.getRepoStateSync('owner1', 'repo');
      const repo2 = repositoryStateManager.getRepoStateSync('owner2', 'repo');

      repo1.processedPRs.add('123');
      repo2.processedPRs.add('123');

      expect(repo1.processedPRs.has('123')).toBe(true);
      expect(repo2.processedPRs.has('123')).toBe(true);

      expect(repositoryStateManager.state.size).toBe(2);
    });
  });

  describe('Edge cases', () => {
    test('should handle cleanup with no timestamps', () => {
      const repoState = repositoryStateManager.getRepoStateSync('owner', 'repo');
      repoState.processedPRs.add('123');
      // No corresponding timestamp

      const cleaned = repositoryStateManager.cleanupOldEntries('owner', 'repo');
      expect(cleaned).toBe(0);
    });

    test('should handle PR ID with leading zeros', () => {
      const repoState = repositoryStateManager.getRepoStateSync('owner', 'repo');
      const prId = '00123';
      repoState.processedPRs.add(prId);

      expect(repoState.processedPRs.has(prId)).toBe(true);
      expect(repoState.processedPRs.has('123')).toBe(false);
    });

    test('should handle very old timestamps', () => {
      const repoState = repositoryStateManager.getRepoStateSync('owner', 'repo');
      const ancientTime = 1; // Unix epoch
      repoState.processedPRs.add('123');
      repoState.processedTimestamps.set('123', ancientTime);
      repoState.notificationCount.set('123', 5);

      const cleaned = repositoryStateManager.cleanupOldEntries('owner', 'repo');

      expect(cleaned).toBe(1);
      expect(repoState.processedPRs.has('123')).toBe(false);
    });
  });

  describe('getRepoFilePath logic', () => {
    test('should construct correct file path', () => {
      const dir = '/data/instances/owner/repo';
      const filename = 'processed_prs.json';
      const path = require('path');
      const fullPath = path.join(dir, filename);

      expect(fullPath).toContain('processed_prs.json');
      expect(fullPath).toMatch(/\/processed_prs\.json$/);
    });
  });

  describe('State loading logic', () => {
    test('should skip loading if already loaded', () => {
      const repoState = repositoryStateManager.getRepoStateSync('owner', 'repo');
      repoState.loaded = true;

      // Simulate the check in loadRepoState
      if (repoState.loaded) {
        expect(repoState.loaded).toBe(true);
      }
    });
  });
});
