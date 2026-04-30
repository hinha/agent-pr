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
  getSnoozeReason: jest.fn()
}));

const { shouldSnooze, getSnoozeReason } = require('../../../../src/utils/timeUtils');

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
          getOpenPRs: jest.fn().mockResolvedValue([]),
          getPRDetails: jest.fn().mockResolvedValue({ files: [], filesChanged: 0, totalChanges: 0 })
        })
      }
    };

    mockConfig = {
      checkIntervalMinutes: 7,
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
