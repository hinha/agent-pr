/**
 * Unit Tests: PRProcessingOrchestrator
 *
 * Tests for the orchestrator's snooze logic for outdated review checks,
 * matching the feature branch's schedulerDaemon.js behavior.
 */

const PRProcessingOrchestrator = require('../../../../src/application/orchestrators/PRProcessingOrchestrator');

// Mock timeUtils module
jest.mock('../../../../src/utils/timeUtils', () => ({
  shouldSnooze: jest.fn(),
  getSnoozeReason: jest.fn(),
  getCurrentTimestampWIB: jest.fn(() => ({
    getTime: () => Date.now() // Return timestamp in WIB (same as local for mock)
  }))
}));

const { shouldSnooze, getSnoozeReason, getCurrentTimestampWIB } = require('../../../../src/utils/timeUtils');

// Make sure getCurrentTimestampWIB always returns an object with getTime
beforeEach(() => {
  getCurrentTimestampWIB.mockReturnValue({
    getTime: () => Date.now()
  });
});

describe('PRProcessingOrchestrator', () => {
  let orchestrator;
  let mockUseCases;
  let mockConfig;
  let mockEventBus;
  let mockLogger;

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockUseCases = {
      processPR: {
        shouldProcess: jest.fn().mockResolvedValue({ shouldProcess: true }),
        execute: jest.fn().mockResolvedValue({ status: 'processed', notificationSent: true })
      },
      checkOutdatedReviews: {
        execute: jest.fn().mockResolvedValue({ totalOutdated: 0 })
      },
      githubService: {
        create: jest.fn().mockReturnValue({
          getOpenPRs: jest.fn().mockResolvedValue([
            {
              id: 'pr-1',
              number: 123,
              title: 'Test PR',
              url: 'https://github.com/testorg/test-repo/pull/123',
              author: 'testuser',
              createdAt: new Date(),
              description: 'Test',
              baseBranch: 'main',
              headBranch: 'feature',
              headSha: 'abc123',
              owner: 'testorg',
              repo: 'test-repo'
            }
          ]),
          getPRDetails: jest.fn().mockResolvedValue({
            files: [],
            filesChanged: 0,
            totalChanges: 0,
            totalFilesChanged: 0
          }),
          getPRReviews: jest.fn().mockResolvedValue([])
        })
      }
    };

    mockConfig = {
      app: {
        outdatedReviewCheckIntervalMs: 0, // Default: run every poll
        checkIntervalMs: 7 * 60 * 1000
      },
      instances: {
        'github/testorg': {
          key: 'github/testorg',
          owner: 'testorg',
          repos: {
            'test-repo': { thread_id: '12345' }
          }
        }
      },
      snoozeTime: {
        enabled: true,
        startHour: 20,
        endHour: 6,
        skipWeekends: true,
        dayNames: ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat']
      }
    };

    mockEventBus = {
      emitAsync: jest.fn().mockResolvedValue(undefined)
    };

    // Reset mocks
    shouldSnooze.mockReset();
    getSnoozeReason.mockReset();

    orchestrator = new PRProcessingOrchestrator(
      mockUseCases,
      mockConfig,
      mockEventBus,
      { logger: mockLogger, pollInterval: 60000 }
    );
  });

  describe('outdated review check interval', () => {
    beforeEach(() => {
      shouldSnooze.mockReturnValue(false); // No snooze
    });

    test('should read outdatedReviewCheckIntervalMs from config', () => {
      const configWithInterval = {
        ...mockConfig,
        app: {
          outdatedReviewCheckIntervalMs: 30 * 60 * 1000 // 30 minutes
        },
        instances: mockConfig.instances,
        snoozeTime: mockConfig.snoozeTime
      };

      const testOrchestrator = new PRProcessingOrchestrator(
        mockUseCases,
        configWithInterval,
        mockEventBus,
        { logger: mockLogger, pollInterval: 60000 }
      );

      expect(testOrchestrator.outdatedReviewCheckInterval).toBe(30 * 60 * 1000);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('PR poll: 60000ms (1min)')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Outdated review check: 1800000ms (30min)')
      );
    });

    test('should run outdated review check on first poll when interval is set', async () => {
      const configWithInterval = {
        ...mockConfig,
        app: {
          ...mockConfig.app,
          outdatedReviewCheckIntervalMs: 10 * 60 * 1000 // 10 minutes
        }
      };

      // Mock shouldProcess to skip PR processing (we only want to test outdated review check)
      mockUseCases.processPR.shouldProcess.mockResolvedValueOnce({ shouldProcess: false, reason: 'Test skip' });
      shouldSnooze.mockReturnValue(false); // No snooze

      const testOrchestrator = new PRProcessingOrchestrator(
        mockUseCases,
        configWithInterval,
        mockEventBus,
        { logger: mockLogger, pollInterval: 60000 }
      );

      await testOrchestrator._poll();

      // First poll should run the check
      expect(mockUseCases.checkOutdatedReviews.execute).toHaveBeenCalled();
      expect(testOrchestrator.lastOutdatedReviewCheckTimeByRepo.get('github/testorg/test-repo')).toBeDefined();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Running outdated review check for test-repo')
      );
    });

    test('should skip outdated review check when interval has not passed', async () => {
      const configWithInterval = {
        ...mockConfig,
        app: {
          ...mockConfig.app,
          outdatedReviewCheckIntervalMs: 30 * 60 * 1000 // 30 minutes
        }
      };

      // Mock shouldProcess to skip PR processing
      mockUseCases.processPR.shouldProcess.mockResolvedValue({ shouldProcess: false, reason: 'Test skip' });

      const testOrchestrator = new PRProcessingOrchestrator(
        mockUseCases,
        configWithInterval,
        mockEventBus,
        { logger: mockLogger, pollInterval: 60000 }
      );

      // Set last check time to now (simulate recent check)
      testOrchestrator.lastOutdatedReviewCheckTimeByRepo.set('github/testorg/test-repo', Date.now());

      await testOrchestrator._poll();

      // Should skip because interval hasn't passed
      expect(mockUseCases.checkOutdatedReviews.execute).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('Skipping outdated review check for test-repo')
      );
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('next check in')
      );
    });

    test('should run outdated review check when interval has passed', async () => {
      const configWithInterval = {
        ...mockConfig,
        app: {
          ...mockConfig.app,
          outdatedReviewCheckIntervalMs: 5 * 60 * 1000 // 5 minutes
        }
      };

      // Mock shouldProcess to skip PR processing
      mockUseCases.processPR.shouldProcess.mockResolvedValue({ shouldProcess: false, reason: 'Test skip' });

      const testOrchestrator = new PRProcessingOrchestrator(
        mockUseCases,
        configWithInterval,
        mockEventBus,
        { logger: mockLogger, pollInterval: 60000 }
      );

      // Set last check time to 6 minutes ago (past the 5 minute interval)
      testOrchestrator.lastOutdatedReviewCheckTimeByRepo.set('github/testorg/test-repo', Date.now() - (6 * 60 * 1000));

      await testOrchestrator._poll();

      // Should run because interval has passed
      expect(mockUseCases.checkOutdatedReviews.execute).toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Running outdated review check for test-repo')
      );
    });

    test('should run on every poll when outdatedReviewCheckIntervalMs is 0 (default behavior)', async () => {
      const configWithZeroInterval = {
        ...mockConfig,
        app: {
          ...mockConfig.app,
          outdatedReviewCheckIntervalMs: 0 // No interval set
        }
      };

      const testOrchestrator = new PRProcessingOrchestrator(
        mockUseCases,
        configWithZeroInterval,
        mockEventBus,
        { logger: mockLogger, pollInterval: 60000 }
      );

      await testOrchestrator._poll();

      // Should run every poll when interval is 0
      expect(mockUseCases.checkOutdatedReviews.execute).toHaveBeenCalled();
    });

    test('should update lastOutdatedReviewCheckTime after running check', async () => {
      const configWithInterval = {
        ...mockConfig,
        app: {
          ...mockConfig.app,
          outdatedReviewCheckIntervalMs: 10 * 60 * 1000
        }
      };

      const testOrchestrator = new PRProcessingOrchestrator(
        mockUseCases,
        configWithInterval,
        mockEventBus,
        { logger: mockLogger, pollInterval: 60000 }
      );

      const beforeTime = Date.now();
      await testOrchestrator._poll();
      const afterTime = Date.now();

      // lastOutdatedReviewCheckTimeByRepo should be updated
      const lastCheck = testOrchestrator.lastOutdatedReviewCheckTimeByRepo.get('github/testorg/test-repo');
      expect(lastCheck).toBeGreaterThanOrEqual(beforeTime);
      expect(lastCheck).toBeLessThanOrEqual(afterTime);
    });

    test('should track outdated review check independently per repo', async () => {
      const configWithInterval = {
        ...mockConfig,
        app: {
          ...mockConfig.app,
          outdatedReviewCheckIntervalMs: 30 * 60 * 1000 // 30 minutes
        },
        instances: {
          'github/testorg': {
            key: 'github/testorg',
            owner: 'testorg',
            repos: {
              'repo-a': { thread_id: '111' },
              'repo-b': { thread_id: '222' }
            }
          }
        }
      };

      // Mock shouldProcess to skip PR processing
      mockUseCases.processPR.shouldProcess.mockResolvedValue({ shouldProcess: false, reason: 'Test skip' });

      const testOrchestrator = new PRProcessingOrchestrator(
        mockUseCases,
        configWithInterval,
        mockEventBus,
        { logger: mockLogger, pollInterval: 60000 }
      );

      // First poll: both repos should run (timestamps undefined)
      await testOrchestrator._poll();
      expect(mockUseCases.checkOutdatedReviews.execute).toHaveBeenCalledTimes(2);

      // Set repo-a to recent (skip), repo-b to old (run)
      mockUseCases.checkOutdatedReviews.execute.mockClear();
      testOrchestrator.lastOutdatedReviewCheckTimeByRepo.set('github/testorg/repo-a', Date.now());
      testOrchestrator.lastOutdatedReviewCheckTimeByRepo.set('github/testorg/repo-b', Date.now() - (31 * 60 * 1000));

      await testOrchestrator._poll();

      // Only repo-b should have run (repo-a skipped due to recent timestamp)
      expect(mockUseCases.checkOutdatedReviews.execute).toHaveBeenCalledTimes(1);
      expect(mockUseCases.checkOutdatedReviews.execute).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: 'repo-b' }),
        expect.any(Array),
        expect.anything()
      );
    });
  });

  describe('snooze check for outdated reviews', () => {
    test('should skip outdated review check when snooze is active', async () => {
      // Simulate snooze active (quiet hours)
      shouldSnooze.mockReturnValue(true);
      getSnoozeReason.mockReturnValue('Snooze time active (20:00 - 6:00)');

      // Trigger a poll cycle
      await orchestrator._poll();

      // Outdated reviews should NOT be called
      expect(mockUseCases.checkOutdatedReviews.execute).not.toHaveBeenCalled();

      // Should log snooze reason
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Snooze time active (20:00 - 6:00)')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Skipping outdated review check for test-repo')
      );
    });

    test('should skip outdated review check on weekends', async () => {
      shouldSnooze.mockReturnValue(true);
      getSnoozeReason.mockReturnValue('Weekend detected');

      await orchestrator._poll();

      expect(mockUseCases.checkOutdatedReviews.execute).not.toHaveBeenCalled();
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Weekend detected')
      );
    });

    test('should run outdated review check when snooze is NOT active', async () => {
      shouldSnooze.mockReturnValue(false);

      await orchestrator._poll();

      expect(mockUseCases.checkOutdatedReviews.execute).toHaveBeenCalled();
    });

    test('should run outdated review check when snooze config is missing', async () => {
      delete mockConfig.snoozeTime;
      shouldSnooze.mockReturnValue(false); // shouldSnooze(null) returns false

      await orchestrator._poll();

      expect(mockUseCases.checkOutdatedReviews.execute).toHaveBeenCalled();
    });

    test('should pass snoozeTime config to shouldSnooze', async () => {
      shouldSnooze.mockReturnValue(false);

      await orchestrator._poll();

      expect(shouldSnooze).toHaveBeenCalledWith(mockConfig.snoozeTime);
    });

    test('should handle outdated review check error gracefully', async () => {
      shouldSnooze.mockReturnValue(false);
      mockUseCases.checkOutdatedReviews.execute.mockRejectedValue(new Error('API error'));

      // Should not throw
      await expect(orchestrator._poll()).resolves.not.toThrow();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Error checking outdated reviews'),
        expect.any(Error)
      );
    });
  });

  describe('lifecycle', () => {
    test('should start and set isRunning', async () => {
      // Use a very large interval to avoid actual polling
      orchestrator.pollInterval = 999999;

      await orchestrator.start();

      expect(orchestrator.isRunning).toBe(true);
      expect(orchestrator.stats.startTime).toBeDefined();

      await orchestrator.stop();
    });

    test('should stop and clear timers', async () => {
      orchestrator.pollInterval = 999999;

      await orchestrator.start();
      await orchestrator.stop();

      expect(orchestrator.isRunning).toBe(false);
      expect(orchestrator.pollTimer).toBeNull();
    });

    test('should not start if already running', async () => {
      orchestrator.pollInterval = 999999;

      await orchestrator.start();
      await orchestrator.start(); // Second call should warn

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Already running')
      );

      await orchestrator.stop();
    });

    test('getStats should return current statistics', () => {
      const stats = orchestrator.getStats();

      expect(stats).toHaveProperty('totalProcessed', 0);
      expect(stats).toHaveProperty('totalNotified', 0);
      expect(stats).toHaveProperty('totalErrors', 0);
      expect(stats).toHaveProperty('isRunning', false);
    });
  });
});
