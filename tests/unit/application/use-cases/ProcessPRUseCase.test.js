/**
 * Unit Tests: ProcessPRUseCase
 *
 * Tests for the PR processing use case including:
 * - Auto-mark as PROCESSED after max notifications (3x)
 * - Notification flow
 * - Skip/already processed handling
 */

const PRStateMachine = require('../../../../src/core/services/PRStateMachine');
const { PRState } = PRStateMachine;
const ProcessPRUseCase = require('../../../../src/application/use-cases/ProcessPRUseCase');

describe('ProcessPRUseCase', () => {
  let useCase;
  let mockStateMachine;
  let mockAnalyzer;
  let mockNotificationService;
  let mockEventBus;
  let mockLogger;

  const instance = {
    key: 'github/testorg',
    owner: 'testorg',
    maxAgeHours: 48,
    maxAgeMs: 48 * 60 * 60 * 1000
  };

  const repo = {
    name: 'test-repo',
    threadId: '12345'
  };

  const mockPR = {
    number: 42,
    title: 'Test PR',
    description: 'A test pull request',
    url: 'https://github.com/testorg/test-repo/pull/42',
    headBranch: 'feature',
    baseBranch: 'main',
    getAgeInMs: () => 3600000,
    getAgeInHours: () => 1
  };

  const mockPRDetails = {
    files: [{ filename: 'src/app.js', changes: 30 }],
    filesChanged: 1,
    totalChanges: 30
  };

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    mockStateMachine = {
      getState: jest.fn().mockResolvedValue(PRState.PENDING),
      shouldNotify: jest.fn().mockResolvedValue(true),
      isSkipped: jest.fn().mockResolvedValue(false),
      transition: jest.fn().mockResolvedValue({
        currentState: PRState.NOTIFIED,
        previousState: PRState.PENDING,
        notificationCount: 1
      }),
      isTerminalState: jest.fn().mockReturnValue(false),
      markAsProcessed: jest.fn().mockResolvedValue({
        currentState: PRState.PROCESSED,
        previousState: PRState.NOTIFIED,
        notificationCount: 3
      }),
      maxNotifications: 3
    };

    mockAnalyzer = {
      analyze: jest.fn().mockReturnValue({
        riskLevel: 'medium',
        impactArea: 'api',
        recommendedReview: 'requires attention',
        suspiciousPatterns: []
      })
    };

    mockNotificationService = {
      sendPRNotification: jest.fn().mockResolvedValue({ success: true, message_id: 123 })
    };

    mockEventBus = {
      emitAsync: jest.fn().mockResolvedValue(undefined)
    };

    useCase = new ProcessPRUseCase(
      mockStateMachine,
      mockAnalyzer,
      mockNotificationService,
      mockEventBus,
      { logger: mockLogger }
    );
  });

  describe('execute', () => {
    test('should process a new PR successfully', async () => {
      const result = await useCase.execute(instance, repo, mockPR, mockPRDetails);

      expect(result.status).toBe('processed');
      expect(result.notificationSent).toBe(true);
      expect(result.notificationCount).toBe(1);

      expect(mockAnalyzer.analyze).toHaveBeenCalledWith(mockPR, mockPRDetails);
      expect(mockStateMachine.transition).toHaveBeenCalledWith(
        'github/testorg', 'test-repo', 42, PRState.NOTIFIED, expect.any(Object)
      );
      expect(mockNotificationService.sendPRNotification).toHaveBeenCalled();
      expect(mockEventBus.emitAsync).toHaveBeenCalledWith('pr.processed', expect.any(Object));
    });

    test('should skip if PR is in skip period', async () => {
      mockStateMachine.isSkipped.mockResolvedValue(true);

      const result = await useCase.execute(instance, repo, mockPR, mockPRDetails);

      expect(result.status).toBe('skipped');
      expect(result.reason).toBe('Skip period active');
      expect(mockNotificationService.sendPRNotification).not.toHaveBeenCalled();
    });

    test('should return already_processed if shouldNotify is false', async () => {
      mockStateMachine.shouldNotify.mockResolvedValue(false);
      mockStateMachine.getState.mockResolvedValue(PRState.NOTIFIED);

      const result = await useCase.execute(instance, repo, mockPR, mockPRDetails);

      expect(result.status).toBe('already_processed');
      expect(result.reason).toBe('Max notifications reached or terminal state');
      expect(mockNotificationService.sendPRNotification).not.toHaveBeenCalled();
    });

    test('should auto-mark as PROCESSED when notification count reaches maxNotifications (3)', async () => {
      // Simulate the 3rd notification
      mockStateMachine.transition.mockResolvedValue({
        currentState: PRState.NOTIFIED,
        previousState: PRState.NOTIFIED,
        notificationCount: 3
      });

      const result = await useCase.execute(instance, repo, mockPR, mockPRDetails);

      expect(result.status).toBe('processed');

      // Verify markAsProcessed was called
      expect(mockStateMachine.markAsProcessed).toHaveBeenCalledWith(
        'github/testorg',
        'test-repo',
        42,
        expect.objectContaining({ reason: 'Max notifications reached' })
      );

      // Verify log message
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('reached max notifications (3/3)')
      );
    });

    test('should NOT auto-mark as PROCESSED when count is below maxNotifications', async () => {
      // Notification count is 1 (below max of 3)
      mockStateMachine.transition.mockResolvedValue({
        currentState: PRState.NOTIFIED,
        previousState: PRState.PENDING,
        notificationCount: 1
      });

      await useCase.execute(instance, repo, mockPR, mockPRDetails);

      expect(mockStateMachine.markAsProcessed).not.toHaveBeenCalled();
    });

    test('should NOT auto-mark as PROCESSED when count is 2', async () => {
      mockStateMachine.transition.mockResolvedValue({
        currentState: PRState.NOTIFIED,
        previousState: PRState.NOTIFIED,
        notificationCount: 2
      });

      await useCase.execute(instance, repo, mockPR, mockPRDetails);

      expect(mockStateMachine.markAsProcessed).not.toHaveBeenCalled();
    });

    test('should log notification count with max (N/3 format)', async () => {
      mockStateMachine.transition.mockResolvedValue({
        currentState: PRState.NOTIFIED,
        previousState: PRState.PENDING,
        notificationCount: 2
      });

      await useCase.execute(instance, repo, mockPR, mockPRDetails);

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('notification count: 2/3')
      );
    });

    test('should emit pr.processed event after notification', async () => {
      await useCase.execute(instance, repo, mockPR, mockPRDetails);

      expect(mockEventBus.emitAsync).toHaveBeenCalledWith('pr.processed', {
        instanceKey: 'github/testorg',
        repoName: 'test-repo',
        prNumber: 42,
        analysis: expect.any(Object),
        notificationSent: true
      });
    });

    test('should handle notification service failure', async () => {
      mockNotificationService.sendPRNotification.mockRejectedValue(new Error('Telegram error'));

      await expect(useCase.execute(instance, repo, mockPR, mockPRDetails))
        .rejects.toThrow('Telegram error');

      expect(mockEventBus.emitAsync).toHaveBeenCalledWith('error.occurred', expect.any(Object));
    });
  });

  describe('shouldProcess', () => {
    test('should return true for processable PR', async () => {
      const result = await useCase.shouldProcess(instance, repo, mockPR, instance);
      expect(result.shouldProcess).toBe(true);
    });

    test('should return false for draft/WIP PR', async () => {
      const wipPR = { ...mockPR, title: '[WIP] Work in progress' };
      const result = await useCase.shouldProcess(instance, repo, wipPR, instance);

      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('PR is draft/WIP');
    });

    test('should return false for old PR', async () => {
      const oldPR = {
        ...mockPR,
        getAgeInMs: () => 50 * 60 * 60 * 1000, // 50 hours
        getAgeInHours: () => 50
      };

      const result = await useCase.shouldProcess(instance, repo, oldPR, instance);

      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('PR too old');
    });

    test('should return false for PR in terminal state', async () => {
      mockStateMachine.getState.mockResolvedValue(PRState.PROCESSED);
      mockStateMachine.isTerminalState.mockReturnValue(true);

      const result = await useCase.shouldProcess(instance, repo, mockPR, instance);

      expect(result.shouldProcess).toBe(false);
      expect(result.reason).toBe('PR in terminal state');
    });
  });
});
