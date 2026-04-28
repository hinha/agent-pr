const FileSystemStateRepository = require('infrastructure/persistence/FileSystemStateRepository');
const fs = require('fs/promises');

// Mock fs module
jest.mock('fs/promises');

describe('FileSystemStateRepository', () => {
  let repository;
  let mockLogger;
  let owner, repo;

  beforeEach(() => {
    owner = 'test-owner';
    repo = 'test-repo';
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    // Clear all mocks
    jest.clearAllMocks();

    // Mock fs.mkdir to succeed
    fs.mkdir.mockResolvedValue(undefined);

    // Mock fs.readFile to return empty state for initial load
    fs.readFile.mockImplementation((filePath) => {
      if (filePath.includes('processed_prs.json')) {
        return Promise.reject({ code: 'ENOENT' });
      }
      return Promise.reject({ code: 'ENOENT' });
    });

    repository = new FileSystemStateRepository(owner, repo, mockLogger, '/tmp/test-data');
  });

  afterEach(async () => {
    await repository.cleanup();
  });

  describe('constructor', () => {
    test('should initialize with owner and repo', () => {
      expect(repository.owner).toBe(owner);
      expect(repository.repo).toBe(repo);
      expect(repository.loaded).toBe(false);
    });

    test('should have correct storage path', () => {
      expect(repository.storagePath).toContain('/tmp/test-data/github-test-owner/test-repo');
    });
  });

  describe('initialize', () => {
    test('should create storage directory', async () => {
      await repository.initialize();

      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('/tmp/test-data/github-test-owner/test-repo'),
        { recursive: true }
      );
      expect(repository.loaded).toBe(true);
    });

    test('should load existing state from files', async () => {
      const mockProcessedData = {
        processed: [1, 2, 3],
        updated: new Date().toISOString()
      };
      const mockCountsData = { '1': 2, '2': 1, '3': 3 };
      const mockTimestampsData = { '1': Date.now(), '2': Date.now(), '3': Date.now() };

      fs.readFile.mockImplementation((filePath) => {
        if (filePath.includes('processed_prs.json')) {
          return Promise.resolve(JSON.stringify(mockProcessedData));
        } else if (filePath.includes('notification_counts.json')) {
          return Promise.resolve(JSON.stringify(mockCountsData));
        } else if (filePath.includes('processed_timestamps.json')) {
          return Promise.resolve(JSON.stringify(mockTimestampsData));
        }
        return Promise.reject({ code: 'ENOENT' });
      });

      await repository.initialize();

      expect(await repository.isProcessed(owner, repo, 1)).toBe(true);
      expect(await repository.isProcessed(owner, repo, 2)).toBe(true);
      expect(await repository.getNotificationCount(owner, repo, 1)).toBe(2);
      expect(repository.loaded).toBe(true);
    });

    test('should handle missing files gracefully', async () => {
      fs.readFile.mockImplementation(() => Promise.reject({ code: 'ENOENT' }));

      await repository.initialize();

      expect(repository.loaded).toBe(true);
      expect(await repository.isProcessed(owner, repo, 1)).toBe(false);
    });
  });

  describe('isProcessed', () => {
    test('should return false for unprocessed PR', async () => {
      await repository.initialize();

      const result = await repository.isProcessed(owner, repo, 123);
      expect(result).toBe(false);
    });

    test('should return true for processed PR', async () => {
      await repository.initialize();
      await repository.markProcessed(owner, repo, 123);

      const result = await repository.isProcessed(owner, repo, 123);
      expect(result).toBe(true);
    });
  });

  describe('markProcessed', () => {
    test('should mark PR as processed', async () => {
      await repository.initialize();
      await repository.markProcessed(owner, repo, 123);

      expect(await repository.isProcessed(owner, repo, 123)).toBe(true);
      expect(fs.writeFile).toHaveBeenCalled();
      expect(fs.writeFile).toHaveBeenCalledTimes(3); // processed, counts, timestamps
    });
  });

  describe('getNotificationCount', () => {
    test('should return 0 for PR with no notifications', async () => {
      await repository.initialize();

      const count = await repository.getNotificationCount(owner, repo, 123);
      expect(count).toBe(0);
    });

    test('should return count for PR with notifications', async () => {
      await repository.initialize();
      await repository.incrementNotificationCount(owner, repo, 123);
      await repository.incrementNotificationCount(owner, repo, 123);

      const count = await repository.getNotificationCount(owner, repo, 123);
      expect(count).toBe(2);
    });
  });

  describe('incrementNotificationCount', () => {
    test('should increment notification count', async () => {
      await repository.initialize();

      const count1 = await repository.incrementNotificationCount(owner, repo, 123);
      expect(count1).toBe(1);

      const count2 = await repository.incrementNotificationCount(owner, repo, 123);
      expect(count2).toBe(2);

      const count3 = await repository.getNotificationCount(owner, repo, 123);
      expect(count3).toBe(2);
    });
  });

  describe('getProcessedPRs', () => {
    test('should return empty array for no processed PRs', async () => {
      await repository.initialize();

      const processed = await repository.getProcessedPRs(owner, repo);
      expect(processed).toEqual([]);
    });

    test('should return all processed PRs', async () => {
      await repository.initialize();
      await repository.markProcessed(owner, repo, 123);
      await repository.markProcessed(owner, repo, 456);
      await repository.markProcessed(owner, repo, 789);

      const processed = await repository.getProcessedPRs(owner, repo);
      expect(processed).toHaveLength(3);
      expect(processed).toContain(123);
      expect(processed).toContain(456);
      expect(processed).toContain(789);
    });
  });

  describe('clearProcessedPRs', () => {
    test('should clear all processed PRs', async () => {
      await repository.initialize();
      await repository.markProcessed(owner, repo, 123);
      await repository.markProcessed(owner, repo, 456);

      await repository.clearProcessedPRs(owner, repo);

      expect(await repository.isProcessed(owner, repo, 123)).toBe(false);
      expect(await repository.isProcessed(owner, repo, 456)).toBe(false);
      expect(await repository.getNotificationCount(owner, repo, 123)).toBe(0);
    });
  });

  describe('getStats', () => {
    test('should return statistics', async () => {
      await repository.initialize();
      await repository.markProcessed(owner, repo, 123);
      await repository.markProcessed(owner, repo, 456);
      await repository.incrementNotificationCount(owner, repo, 123);
      await repository.incrementNotificationCount(owner, repo, 123);
      await repository.incrementNotificationCount(owner, repo, 456);

      const stats = await repository.getStats();

      expect(stats.totalRepos).toBe(1);
      expect(stats.totalProcessedPRs).toBe(2);
      expect(stats.totalNotifications).toBe(3);
    });
  });

  describe('cleanup', () => {
    test('should clean up resources', async () => {
      await repository.initialize();
      await repository.markProcessed(owner, repo, 123);

      await repository.cleanup();

      expect(repository.cache.processedPRs.size).toBe(0);
      expect(repository.loaded).toBe(false);
    });
  });
});
