/**
 * SkipManager Unit Tests
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const SkipManager = require('../../../../src/infrastructure/persistence/SkipManager');

describe('SkipManager', () => {
  let skipManager;
  let tempDir;
  let mockLogger;

  const owner = 'test-owner';
  const repo = 'test-repo';

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skip-test-'));

    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    skipManager = new SkipManager(mockLogger, { instances: {} });
    // Override storage path to use temp dir
    skipManager.getStoragePath = (o, r) => {
      const instanceKey = `github-${o}`;
      return path.join(tempDir, 'instances', instanceKey, r);
    };
  });

  afterEach(async () => {
    await skipManager.cleanup();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor', () => {
    test('should initialize with default values', () => {
      const manager = new SkipManager(mockLogger, {});
      expect(manager.skipCache.size).toBe(0);
      expect(manager.loaded).toBe(false);
      expect(manager.logger).toBe(mockLogger);
      expect(manager.config).toEqual({});
    });
  });

  describe('isSkipped()', () => {
    test('should return false if PR is not in skip cache', async () => {
      const result = await skipManager.isSkipped(owner, repo, 123);
      expect(result).toBe(false);
    });

    test('should return true if PR has active skip entry', async () => {
      await skipManager.addSkip(owner, repo, 123);

      const result = await skipManager.isSkipped(owner, repo, 123);
      expect(result).toBe(true);
    });

    test('should return false and remove expired skip entry', async () => {
      // Manually set expired entry
      const key = skipManager.getRepoKey(owner, repo);
      const expiredMap = new Map();
      expiredMap.set('123', Date.now() - 1000); // 1 second ago
      skipManager.skipCache.set(key, expiredMap);

      const result = await skipManager.isSkipped(owner, repo, 123);
      expect(result).toBe(false);
      expect(expiredMap.has('123')).toBe(false);
    });

    test('should handle missing cache file gracefully', async () => {
      // No file created yet
      const result = await skipManager.isSkipped(owner, repo, 999);
      expect(result).toBe(false);
    });

    test('should handle numeric and string prId', async () => {
      await skipManager.addSkip(owner, repo, 456);

      // Both numeric and string should match
      expect(await skipManager.isSkipped(owner, repo, 456)).toBe(true);
      expect(await skipManager.isSkipped(owner, repo, '456')).toBe(true);
    });

    test('should return false when repo cache is null after load', async () => {
      // Simulate edge case where cache is unexpectedly null
      skipManager.skipCache.set(skipManager.getRepoKey(owner, repo), null);

      const result = await skipManager.isSkipped(owner, repo, 123);
      expect(result).toBe(false);
    });
  });

  describe('addSkip()', () => {
    test('should add skip entry with default 3h duration', async () => {
      const before = Date.now();
      await skipManager.addSkip(owner, repo, 123);
      const after = Date.now();

      const key = skipManager.getRepoKey(owner, repo);
      const repoCache = skipManager.skipCache.get(key);
      const expiry = repoCache.get('123');

      const threeHours = 3 * 60 * 60 * 1000;
      expect(expiry).toBeGreaterThanOrEqual(before + threeHours);
      expect(expiry).toBeLessThanOrEqual(after + threeHours);
    });

    test('should add skip entry with custom duration from config', async () => {
      const customDuration = 5 * 60 * 60 * 1000; // 5 hours
      const config = {
        instances: {
          'github/test-owner': {
            skipDurationMs: customDuration
          }
        }
      };
      const manager = new SkipManager(mockLogger, config);
      manager.getStoragePath = (o, r) => {
        return path.join(tempDir, 'custom', `github-${o}`, r);
      };

      const before = Date.now();
      await manager.addSkip(owner, repo, 789);
      const after = Date.now();

      const key = manager.getRepoKey(owner, repo);
      const expiry = manager.skipCache.get(key).get('789');

      expect(expiry).toBeGreaterThanOrEqual(before + customDuration);
      expect(expiry).toBeLessThanOrEqual(after + customDuration);

      await manager.cleanup();
    });

    test('should create new repo cache if not exists', async () => {
      const key = skipManager.getRepoKey(owner, repo);
      expect(skipManager.skipCache.has(key)).toBe(false);

      await skipManager.addSkip(owner, repo, 123);

      expect(skipManager.skipCache.has(key)).toBe(true);
      expect(skipManager.skipCache.get(key).get('123')).toBeDefined();
    });

    test('should persist to file after adding', async () => {
      await skipManager.addSkip(owner, repo, 123);

      const skipCachePath = skipManager.getSkipCachePath(owner, repo);
      const raw = await fs.readFile(skipCachePath, 'utf8');
      const data = JSON.parse(raw);

      expect(data['123']).toBeDefined();
      expect(typeof data['123']).toBe('number');
    });

    test('should log info message after adding', async () => {
      await skipManager.addSkip(owner, repo, 123);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Added skip for PR #123')
      );
    });

    test('should handle multiple PRs in same repo', async () => {
      await skipManager.addSkip(owner, repo, 111);
      await skipManager.addSkip(owner, repo, 222);
      await skipManager.addSkip(owner, repo, 333);

      const key = skipManager.getRepoKey(owner, repo);
      expect(skipManager.skipCache.get(key).size).toBe(3);

      expect(await skipManager.isSkipped(owner, repo, 111)).toBe(true);
      expect(await skipManager.isSkipped(owner, repo, 222)).toBe(true);
      expect(await skipManager.isSkipped(owner, repo, 333)).toBe(true);
    });
  });

  describe('removeSkip()', () => {
    test('should remove existing skip entry and save', async () => {
      await skipManager.addSkip(owner, repo, 123);
      expect(await skipManager.isSkipped(owner, repo, 123)).toBe(true);

      await skipManager.removeSkip(owner, repo, 123);
      expect(await skipManager.isSkipped(owner, repo, 123)).toBe(false);
    });

    test('should do nothing if PR not in skip cache', async () => {
      await skipManager.addSkip(owner, repo, 123);

      // Try to remove non-existent PR
      await skipManager.removeSkip(owner, repo, 999);

      // Original entry should still exist
      expect(await skipManager.isSkipped(owner, repo, 123)).toBe(true);
    });

    test('should do nothing if repo cache not exists', async () => {
      // No cache loaded yet
      await skipManager.removeSkip(owner, repo, 123);
      // Should not throw
    });

    test('should log debug when removing entry', async () => {
      await skipManager.addSkip(owner, repo, 123);
      mockLogger.debug.mockClear();

      await skipManager.removeSkip(owner, repo, 123);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Removed skip for PR #123')
      );
    });
  });

  describe('removeExpired()', () => {
    test('should remove expired entries and return count', async () => {
      const key = skipManager.getRepoKey(owner, repo);
      const repoCache = new Map();
      repoCache.set('111', Date.now() - 1000); // expired
      repoCache.set('222', Date.now() - 2000); // expired
      repoCache.set('333', Date.now() + 100000); // still active
      skipManager.skipCache.set(key, repoCache);

      const cleaned = await skipManager.removeExpired(owner, repo);

      expect(cleaned).toBe(2);
      expect(repoCache.size).toBe(1);
      expect(repoCache.has('333')).toBe(true);
    });

    test('should return 0 if no expired entries', async () => {
      const key = skipManager.getRepoKey(owner, repo);
      const repoCache = new Map();
      repoCache.set('111', Date.now() + 100000); // active
      skipManager.skipCache.set(key, repoCache);

      const cleaned = await skipManager.removeExpired(owner, repo);

      expect(cleaned).toBe(0);
      expect(repoCache.size).toBe(1);
    });

    test('should return 0 if repo cache not exists', async () => {
      const cleaned = await skipManager.removeExpired(owner, repo);
      expect(cleaned).toBe(0);
    });

    test('should persist after removing expired entries', async () => {
      const key = skipManager.getRepoKey(owner, repo);
      const repoCache = new Map();
      repoCache.set('111', Date.now() - 1000); // expired
      repoCache.set('222', Date.now() + 100000); // active
      skipManager.skipCache.set(key, repoCache);

      await skipManager.removeExpired(owner, repo);

      // Verify file was saved
      const skipCachePath = skipManager.getSkipCachePath(owner, repo);
      const raw = await fs.readFile(skipCachePath, 'utf8');
      const data = JSON.parse(raw);

      expect(data['111']).toBeUndefined();
      expect(data['222']).toBeDefined();
    });

    test('should not save if nothing was cleaned', async () => {
      const key = skipManager.getRepoKey(owner, repo);
      const repoCache = new Map();
      repoCache.set('111', Date.now() + 100000); // active
      skipManager.skipCache.set(key, repoCache);
      // Load first so cache exists
      await skipManager.loadRepoSkipCache(owner, repo);
      mockLogger.debug.mockClear();

      await skipManager.removeExpired(owner, repo);

      // Should NOT log about saving since nothing was cleaned
      expect(mockLogger.debug).not.toHaveBeenCalledWith(
        expect.stringContaining('Cleaned')
      );
    });
  });

  describe('getStats()', () => {
    test('should return zero stats for empty cache', () => {
      const stats = skipManager.getStats();

      expect(stats.totalRepos).toBe(0);
      expect(stats.totalSkippedPRs).toBe(0);
    });

    test('should return stats with total repos and skipped PRs', async () => {
      await skipManager.addSkip('owner1', 'repo1', 111);
      await skipManager.addSkip('owner1', 'repo1', 222);
      await skipManager.addSkip('owner2', 'repo2', 333);

      const stats = skipManager.getStats();

      expect(stats.totalRepos).toBe(2);
      expect(stats.totalSkippedPRs).toBe(3);
    });
  });

  describe('cleanup()', () => {
    test('should clear all cache and reset loaded flag', async () => {
      await skipManager.addSkip(owner, repo, 123);
      expect(skipManager.skipCache.size).toBe(1);

      await skipManager.cleanup();

      expect(skipManager.skipCache.size).toBe(0);
      expect(skipManager.loaded).toBe(false);
    });
  });

  describe('error handling', () => {
    test('should handle file read errors (non-ENOENT)', async () => {
      // Create an invalid JSON file
      const storagePath = skipManager.getStoragePath(owner, repo);
      await fs.mkdir(storagePath, { recursive: true });
      const skipCachePath = skipManager.getSkipCachePath(owner, repo);
      await fs.writeFile(skipCachePath, 'invalid-json', 'utf8');

      // Should not throw, should create empty cache
      const result = await skipManager.isSkipped(owner, repo, 123);
      expect(result).toBe(false);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error loading skip cache')
      );
    });

    test('should handle file write errors', async () => {
      // Make the path unwritable by pointing to an impossible location
      const originalPath = skipManager.getStoragePath;
      skipManager.getStoragePath = () => '/nonexistent-root/path/that/cannot/be/created';
      skipManager.getSkipCachePath = (o, r) => {
        return path.join('/nonexistent-root/path/that/cannot/be/created', 'skip_cache.json');
      };

      await expect(skipManager.addSkip(owner, repo, 123)).rejects.toThrow();

      // Restore
      skipManager.getStoragePath = originalPath;
    });

    test('should log warn when saving with no cache', async () => {
      // Directly call saveRepoSkipCache without adding anything
      await skipManager.saveRepoSkipCache(owner, repo);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('No skip cache to save')
      );
    });

    test('should handle ENOENT gracefully on load', async () => {
      // No file exists - should create empty cache
      const result = await skipManager.isSkipped(owner, repo, 123);
      expect(result).toBe(false);

      const key = skipManager.getRepoKey(owner, repo);
      expect(skipManager.skipCache.has(key)).toBe(true);
      expect(skipManager.skipCache.get(key).size).toBe(0);
    });
  });

  describe('persistence across instances', () => {
    test('should persist and reload skip entries', async () => {
      // Add skip entry
      await skipManager.addSkip(owner, repo, 123);

      // Create new instance pointing to same temp dir
      const manager2 = new SkipManager(mockLogger, { instances: {} });
      manager2.getStoragePath = (o, r) => {
        const instanceKey = `github-${o}`;
        return path.join(tempDir, 'instances', instanceKey, r);
      };

      // Should load the skip entry from file
      const result = await manager2.isSkipped(owner, repo, 123);
      expect(result).toBe(true);

      await manager2.cleanup();
    });

    test('should filter expired entries when loading from file', async () => {
      // Write expired entry directly to file
      const storagePath = skipManager.getStoragePath(owner, repo);
      await fs.mkdir(storagePath, { recursive: true });
      const skipCachePath = skipManager.getSkipCachePath(owner, repo);
      const data = {
        '123': Date.now() - 1000, // expired
        '456': Date.now() + 100000 // active
      };
      await fs.writeFile(skipCachePath, JSON.stringify(data), 'utf8');

      // Create new manager to force file load
      const manager2 = new SkipManager(mockLogger, { instances: {} });
      manager2.getStoragePath = (o, r) => {
        return path.join(tempDir, 'instances', `github-${o}`, r);
      };

      expect(await manager2.isSkipped(owner, repo, 123)).toBe(false);
      expect(await manager2.isSkipped(owner, repo, 456)).toBe(true);

      await manager2.cleanup();
    });
  });
});
