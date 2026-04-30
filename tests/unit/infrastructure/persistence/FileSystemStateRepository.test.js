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
      expect(fs.writeFile).toHaveBeenCalledTimes(4); // processed, counts, timestamps, review_state
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

  describe('notification count sync', () => {
    test('should sync notification counts from notification_counts.json to review_state.json during load', async () => {
      const mockCountsData = { '123': 2, '456': 1 };
      // review_state.json has structure: { reviews: { ... }, outdatedNotified: { ... } }
      const mockReviewStateData = {
        reviews: {
          '123': { state: 'notified', lastUpdated: new Date().toISOString() }
        }
      };

      fs.readFile.mockImplementation((filePath) => {
        if (filePath.includes('notification_counts.json')) {
          return Promise.resolve(JSON.stringify(mockCountsData));
        } else if (filePath.includes('review_state.json')) {
          return Promise.resolve(JSON.stringify(mockReviewStateData));
        } else if (filePath.includes('processed_prs.json')) {
          return Promise.reject({ code: 'ENOENT' });
        }
        return Promise.reject({ code: 'ENOENT' });
      });

      await repository.initialize();

      // Debug: check what's in the cache
      // console.log('notificationCounts size:', repository.cache.notificationCounts.size);
      // console.log('notificationCounts:', Array.from(repository.cache.notificationCounts.entries()));
      // console.log('reviewState size:', repository.cache.reviewState.size);
      // console.log('reviewState:', Array.from(repository.cache.reviewState.entries()));

      // PR 123 should have notificationCount synced from notification_counts.json
      // Note: cache.reviewState stores numeric keys
      const reviewState123 = repository.cache.reviewState.get(123);
      expect(reviewState123).toBeDefined();
      expect(reviewState123.notificationCount).toBe(2);

      // PR 456 should have review_state entry created with notificationCount
      const reviewState456 = repository.cache.reviewState.get(456);
      expect(reviewState456).toBeDefined();
      expect(reviewState456.notificationCount).toBe(1);
      expect(reviewState456.state).toBe('pending');
    });

    test('should not overwrite higher notificationCount in review_state.json', async () => {
      const mockCountsData = { '123': 1 };
      const mockReviewStateData = {
        reviews: {
          '123': { state: 'notified', notificationCount: 3, lastUpdated: new Date().toISOString() }
        }
      };

      fs.readFile.mockImplementation((filePath) => {
        if (filePath.includes('notification_counts.json')) {
          return Promise.resolve(JSON.stringify(mockCountsData));
        } else if (filePath.includes('review_state.json')) {
          return Promise.resolve(JSON.stringify(mockReviewStateData));
        } else if (filePath.includes('processed_prs.json')) {
          return Promise.reject({ code: 'ENOENT' });
        }
        return Promise.reject({ code: 'ENOENT' });
      });

      await repository.initialize();

      // Should keep the higher count from review_state.json
      const reviewState123 = repository.cache.reviewState.get(123);
      expect(reviewState123).toBeDefined();
      expect(reviewState123.notificationCount).toBe(3);
    });

    test('should set missing notificationCount in review_state.json from notification_counts.json', async () => {
      const mockCountsData = { '123': 2 };
      const mockReviewStateData = {
        reviews: {
          '123': { state: 'notified', lastUpdated: new Date().toISOString() }
        }
      };

      fs.readFile.mockImplementation((filePath) => {
        if (filePath.includes('notification_counts.json')) {
          return Promise.resolve(JSON.stringify(mockCountsData));
        } else if (filePath.includes('review_state.json')) {
          return Promise.resolve(JSON.stringify(mockReviewStateData));
        } else if (filePath.includes('processed_prs.json')) {
          return Promise.reject({ code: 'ENOENT' });
        }
        return Promise.reject({ code: 'ENOENT' });
      });

      await repository.initialize();

      // Should set notificationCount from notification_counts.json
      const reviewState123 = repository.cache.reviewState.get(123);
      expect(reviewState123).toBeDefined();
      expect(reviewState123.notificationCount).toBe(2);
    });
  });

  describe('_persistNotificationCount', () => {
    test('should persist notification count to notification_counts.json', async () => {
      await repository.initialize();

      await repository._persistNotificationCount(123, 2);

      expect(fs.writeFile).toHaveBeenCalled();
      const writeCall = fs.writeFile.mock.calls.find(call =>
        call[0].includes('notification_counts.json')
      );
      expect(writeCall).toBeDefined();
      expect(JSON.parse(writeCall[1])).toEqual({ '123': 2 });
    });

    test('should update in-memory cache after persisting', async () => {
      await repository.initialize();

      await repository._persistNotificationCount(123, 3);

      expect(repository.cache.notificationCounts.get(123)).toBe(3);
    });

    test('should merge with existing notification counts', async () => {
      const existingCounts = { '100': 1, '200': 2 };
      fs.readFile.mockImplementation((filePath) => {
        if (filePath.includes('notification_counts.json')) {
          return Promise.resolve(JSON.stringify(existingCounts));
        }
        return Promise.reject({ code: 'ENOENT' });
      });

      await repository.initialize();

      await repository._persistNotificationCount(300, 3);

      const writeCall = fs.writeFile.mock.calls.find(call =>
        call[0].includes('notification_counts.json')
      );
      const persistedData = JSON.parse(writeCall[1]);
      expect(persistedData).toEqual({ '100': 1, '200': 2, '300': 3 });
    });

    test('should handle non-existing notification_counts.json file', async () => {
      fs.readFile.mockImplementation((filePath) => {
        if (filePath.includes('notification_counts.json')) {
          return Promise.reject({ code: 'ENOENT' });
        }
        return Promise.reject({ code: 'ENOENT' });
      });

      await repository.initialize();

      await repository._persistNotificationCount(123, 1);

      const writeCall = fs.writeFile.mock.calls.find(call =>
        call[0].includes('notification_counts.json')
      );
      expect(writeCall).toBeDefined();
      expect(JSON.parse(writeCall[1])).toEqual({ '123': 1 });
    });

    test('should handle write errors gracefully', async () => {
      await repository.initialize();
      fs.writeFile.mockRejectedValue(new Error('Write failed'));

      await expect(repository._persistNotificationCount(123, 1)).rejects.toThrow('Write failed');
    });
  });
});
