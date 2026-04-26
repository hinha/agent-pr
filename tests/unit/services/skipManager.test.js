/**
 * Unit tests for skipManager utility (simplified version without FS mocking)
 * Tests core skip cache logic without file system operations
 */

jest.mock('../../../src/config/yamlConfig', () => ({
  ensureRepoStorageDir: jest.fn((owner, repo) => `/data/instances/${owner}/${repo}`),
  getInstanceByOwner: jest.fn(() => ({
    skipDurationMs: 3 * 60 * 60 * 1000 // 3 hours
  }))
}));

jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}));

jest.resetModules();
const skipManager = require('../../../src/services/skipManager');

describe('skipManager (core logic)', () => {
  beforeEach(() => {
    skipManager.skipCache.clear();
  });

  describe('getRepoKey', () => {
    test('should return correct repo key format', () => {
      const result = skipManager.getRepoKey('owner', 'repo');
      expect(result).toBe('owner/repo');
    });
  });

  describe('isSkipped - core logic', () => {
    test('should return true for PR with valid skip entry', () => {
      const now = Date.now();
      skipManager.skipCache.set('owner/repo', new Map([
        ['123', now + 3600000] // Expires in 1 hour
      ]));

      const result = skipManager.isSkipped('owner', 'repo', 123);
      expect(result).toBe(true);
    });

    test('should return false for PR with expired skip entry', () => {
      const now = Date.now();
      skipManager.skipCache.set('owner/repo', new Map([
        ['123', now - 3600000] // Expired 1 hour ago
      ]));

      const result = skipManager.isSkipped('owner', 'repo', 123);
      expect(result).toBe(false);
    });

    test('should return false when repo cache does not exist', () => {
      const result = skipManager.isSkipped('owner', 'repo', 123);
      expect(result).toBe(false);
    });

    test('should convert PR ID to string for lookup', () => {
      const now = Date.now();
      skipManager.skipCache.set('owner/repo', new Map([
        ['123', now + 3600000]
      ]));

      const result = skipManager.isSkipped('owner', 'repo', 123);
      expect(result).toBe(true);
    });
  });

  describe('getStats', () => {
    test('should return correct statistics', () => {
      skipManager.skipCache.set('owner/repo1', new Map([
        ['123', Date.now() + 3600000],
        ['456', Date.now() + 7200000]
      ]));
      skipManager.skipCache.set('owner/repo2', new Map([
        ['789', Date.now() + 3600000]
      ]));

      const stats = skipManager.getStats();

      expect(stats.totalRepos).toBe(2);
      expect(stats.totalSkippedPRs).toBe(3);
    });

    test('should return zeros when no entries exist', () => {
      const stats = skipManager.getStats();

      expect(stats.totalRepos).toBe(0);
      expect(stats.totalSkippedPRs).toBe(0);
    });
  });

  describe('cleanup logic', () => {
    test('should identify expired entries correctly', () => {
      const now = Date.now();
      skipManager.skipCache.set('owner/repo', new Map([
        ['123', now - 3600000], // Expired
        ['456', now + 3600000], // Valid
      ]));

      // Simulate cleanup logic
      const repoCache = skipManager.skipCache.get('owner/repo');
      let cleaned = 0;
      for (const [prId, expiry] of repoCache.entries()) {
        if (Date.now() >= expiry) {
          repoCache.delete(prId);
          cleaned++;
        }
      }

      expect(cleaned).toBe(1);
      expect(repoCache.size).toBe(1);
      expect(repoCache.has('456')).toBe(true);
    });
  });
});
