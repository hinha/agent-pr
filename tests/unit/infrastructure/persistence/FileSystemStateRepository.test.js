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
      expect(fs.writeFile).toHaveBeenCalledTimes(3); // processed, timestamps, review_state (counts not written here anymore)
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

      // Mock fs.readFile to return the persisted notification count
      fs.readFile.mockImplementation((filePath) => {
        if (filePath.includes('notification_counts.json')) {
          return Promise.resolve(JSON.stringify({ '123': 2 }));
        }
        if (filePath.includes('processed_prs.json')) {
          return Promise.reject({ code: 'ENOENT' });
        }
        return Promise.reject({ code: 'ENOENT' });
      });

      const count = await repository.getNotificationCount(owner, repo, 123);
      expect(count).toBe(2);
    });
  });

  describe('incrementNotificationCount', () => {
    test('should increment notification count', async () => {
      await repository.initialize();

      // Track notification counts to simulate file storage
      let notificationCounts = {};

      // Mock fs.writeFile to track notification counts
      fs.writeFile.mockImplementation((filePath, data) => {
        if (filePath.includes('notification_counts.json')) {
          notificationCounts = JSON.parse(data);
        }
        return Promise.resolve();
      });

      // Mock fs.readFile to return tracked notification counts
      fs.readFile.mockImplementation((filePath) => {
        if (filePath.includes('notification_counts.json')) {
          return Object.keys(notificationCounts).length > 0
            ? Promise.resolve(JSON.stringify(notificationCounts))
            : Promise.reject({ code: 'ENOENT' });
        }
        if (filePath.includes('processed_prs.json')) {
          return Promise.reject({ code: 'ENOENT' });
        }
        return Promise.reject({ code: 'ENOENT' });
      });

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

      // Mock fs.readFile to return the persisted notification counts
      fs.readFile.mockImplementation((filePath) => {
        if (filePath.includes('notification_counts.json')) {
          return Promise.resolve(JSON.stringify({ '123': 2, '456': 1 }));
        }
        if (filePath.includes('processed_prs.json')) {
          return Promise.resolve(JSON.stringify({
            processed: [123, 456],
            updated: new Date().toISOString()
          }));
        }
        return Promise.reject({ code: 'ENOENT' });
      });

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

  describe('notification count - file-based storage', () => {
    test('should NOT sync notification counts to review_state.json during load', async () => {
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

      // PR 123 should NOT have notificationCount synced - it should be undefined
      const reviewState123 = repository.cache.reviewState.get(123);
      expect(reviewState123).toBeDefined();
      expect(reviewState123.notificationCount).toBeUndefined();

      // PR 456 should NOT have review_state entry created
      const reviewState456 = repository.cache.reviewState.get(456);
      expect(reviewState456).toBeUndefined();
    });

    test('should not overwrite notificationCount in review_state.json', async () => {
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

      // Should keep the notificationCount from review_state.json (no sync is done)
      const reviewState123 = repository.cache.reviewState.get(123);
      expect(reviewState123).toBeDefined();
      expect(reviewState123.notificationCount).toBe(3); // From review_state.json, not from notification_counts.json
    });

    test('should not sync notification counts to review_state.json during load', async () => {
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

      // Should NOT sync - review_state.json should remain as is
      const reviewState123 = repository.cache.reviewState.get(123);
      expect(reviewState123).toBeDefined();
      expect(reviewState123.notificationCount).toBeUndefined(); // No sync anymore
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

    test('should NOT update in-memory cache after persisting (file is source of truth)', async () => {
      await repository.initialize();

      await repository._persistNotificationCount(123, 3);

      // Cache should NOT be updated - reads are done directly from file
      expect(repository.cache.notificationCounts.get(123)).toBeUndefined();
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

  describe('outdated review notification tracking', () => {
    test('should mark outdated review as dismissed for a headSha', async () => {
      await repository.initialize();
      await repository.markOutdatedNotified(owner, repo, '9', 'abc123def');

      const isDismissed = await repository.isOutdatedNotified(owner, repo, '9', 'abc123def');
      expect(isDismissed).toBe(true);
    });

    test('should return false for non-dismissed headSha', async () => {
      await repository.initialize();

      const isDismissed = await repository.isOutdatedNotified(owner, repo, '9', 'abc123def');
      expect(isDismissed).toBe(false);
    });

    test('should not match different headSha', async () => {
      await repository.initialize();
      await repository.markOutdatedNotified(owner, repo, '9', 'abc123def');

      // Same PR but different headSha (new commits pushed)
      expect(await repository.isOutdatedNotified(owner, repo, '9', 'abc123def')).toBe(true);
      expect(await repository.isOutdatedNotified(owner, repo, '9', 'xyz789')).toBe(false);
    });

    test('should persist outdated dismissed to JSON as object', async () => {
      await repository.initialize();

      await repository.markOutdatedNotified(owner, repo, '9', 'abc123def');

      expect(fs.writeFile).toHaveBeenCalled();
      const writeCalls = fs.writeFile.mock.calls.filter(call =>
        call[0].includes('review_state.json')
      );
      expect(writeCalls.length).toBeGreaterThan(0);

      const writeCall = writeCalls[writeCalls.length - 1];
      const persistedData = JSON.parse(writeCall[1]);
      expect(persistedData.outdatedNotified['9']).toEqual({ dismissedHeadSha: 'abc123def' });
    });

    test('should load outdated dismissed from JSON object', async () => {
      const mockReviewStateData = {
        reviews: {},
        outdatedNotified: {
          '9': { dismissedHeadSha: 'abc123def' }
        }
      };

      fs.readFile.mockImplementation((filePath) => {
        if (filePath.includes('review_state.json')) {
          return Promise.resolve(JSON.stringify(mockReviewStateData));
        }
        return Promise.reject({ code: 'ENOENT' });
      });

      await repository.initialize();

      expect(await repository.isOutdatedNotified(owner, repo, '9', 'abc123def')).toBe(true);
      expect(await repository.isOutdatedNotified(owner, repo, '9', 'different-sha')).toBe(false);
    });

    test('should clear outdated dismiss for PR', async () => {
      await repository.initialize();

      await repository.markOutdatedNotified(owner, repo, '9', 'abc123def');
      expect(await repository.isOutdatedNotified(owner, repo, '9', 'abc123def')).toBe(true);

      await repository.clearOutdatedNotified(owner, repo, '9');
      expect(await repository.isOutdatedNotified(owner, repo, '9', 'abc123def')).toBe(false);
    });

    test('should track dismiss for multiple PRs separately', async () => {
      await repository.initialize();

      await repository.markOutdatedNotified(owner, repo, '9', 'sha-abc');
      await repository.markOutdatedNotified(owner, repo, '10', 'sha-xyz');

      expect(await repository.isOutdatedNotified(owner, repo, '9', 'sha-abc')).toBe(true);
      expect(await repository.isOutdatedNotified(owner, repo, '9', 'sha-xyz')).toBe(false);
      expect(await repository.isOutdatedNotified(owner, repo, '10', 'sha-abc')).toBe(false);
      expect(await repository.isOutdatedNotified(owner, repo, '10', 'sha-xyz')).toBe(true);
    });

    test('should ignore old array format on load (backward compatibility)', async () => {
      // Old format: array of reviewIds - should be ignored
      const mockReviewStateData = {
        reviews: {},
        outdatedNotified: {
          '9': ['review-1', 'review-2', 'review-3']
        }
      };

      fs.readFile.mockImplementation((filePath) => {
        if (filePath.includes('review_state.json')) {
          return Promise.resolve(JSON.stringify(mockReviewStateData));
        }
        return Promise.reject({ code: 'ENOENT' });
      });

      await repository.initialize();

      // Old array format should be ignored - no dismissedHeadSha match
      expect(await repository.isOutdatedNotified(owner, repo, '9', 'review-1')).toBe(false);
    });

    test('should ignore old single-value format on load (backward compatibility)', async () => {
      // Old format: single reviewId (number or string)
      const mockReviewStateData = {
        reviews: {},
        outdatedNotified: {
          '9': 4138295901,  // Old format: single number
          '10': 'review-1'  // Old format: single string
        }
      };

      fs.readFile.mockImplementation((filePath) => {
        if (filePath.includes('review_state.json')) {
          return Promise.resolve(JSON.stringify(mockReviewStateData));
        }
        return Promise.reject({ code: 'ENOENT' });
      });

      await repository.initialize();

      // Old single-value format should be ignored
      expect(await repository.isOutdatedNotified(owner, repo, '9', '4138295901')).toBe(false);
      expect(await repository.isOutdatedNotified(owner, repo, '10', 'review-1')).toBe(false);
    });

    test('should replace dismiss when marking again for new headSha', async () => {
      await repository.initialize();

      await repository.markOutdatedNotified(owner, repo, '9', 'sha-old');
      expect(await repository.isOutdatedNotified(owner, repo, '9', 'sha-old')).toBe(true);

      // Dismiss again with new headSha (e.g., after new commits + dismiss again)
      await repository.markOutdatedNotified(owner, repo, '9', 'sha-new');
      expect(await repository.isOutdatedNotified(owner, repo, '9', 'sha-new')).toBe(true);
      // Old headSha should no longer match
      expect(await repository.isOutdatedNotified(owner, repo, '9', 'sha-old')).toBe(false);
    });
  });
});
