const InMemoryStateRepository = require('infrastructure/persistence/InMemoryStateRepository');

describe('InMemoryStateRepository', () => {
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

    jest.clearAllMocks();

    repository = new InMemoryStateRepository(owner, repo, mockLogger);
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
  });

  describe('initialize', () => {
    test('should mark as loaded', async () => {
      await repository.initialize();

      expect(repository.loaded).toBe(true);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Initialized')
      );
    });

    test('should be idempotent', async () => {
      await repository.initialize();
      await repository.initialize();

      expect(repository.loaded).toBe(true);
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
    });

    test('should log debug message', async () => {
      await repository.initialize();
      await repository.markProcessed(owner, repo, 123);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Marked PR #123 as processed')
      );
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

    test('should log debug message', async () => {
      await repository.initialize();
      await repository.markProcessed(owner, repo, 123);

      await repository.clearProcessedPRs(owner, repo);

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Cleared all state')
      );
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

      expect(repository.storage.processedPRs.size).toBe(0);
      expect(repository.loaded).toBe(false);
    });
  });
});
