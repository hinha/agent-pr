/**
 * Unit tests for SendNotificationUseCase
 */

const SendNotificationUseCase = require('../../../../src/application/use-cases/SendNotificationUseCase');

describe('SendNotificationUseCase', () => {
  let useCase;
  let telegramService;
  let stateMachine;
  let eventBus;
  let logger;

  beforeEach(() => {
    telegramService = {
      sendPRNotification: jest.fn().mockResolvedValue({ message_id: 42 })
    };
    stateMachine = {
      getNotificationCount: jest.fn().mockResolvedValue(1)
    };
    eventBus = {
      emitAsync: jest.fn().mockResolvedValue()
    };
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn()
    };
    useCase = new SendNotificationUseCase(telegramService, stateMachine, eventBus, { logger });
  });

  describe('execute', () => {
    const instance = { key: 'github/myorg', owner: 'myorg' };
    const repo = { name: 'my-repo', threadId: 12345 };
    const pr = { number: 42, description: 'Fix bug' };
    const analysis = {
      purpose: 'Fix login bug',
      riskLevel: 'medium',
      impactArea: 'auth',
      suspiciousPatterns: []
    };

    it('should send notification and emit event on success', async () => {
      const result = await useCase.execute(instance, repo, pr, analysis);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe(42);
      expect(result.notificationCount).toBe(1);

      expect(stateMachine.getNotificationCount).toHaveBeenCalledWith(
        'github/myorg', 'my-repo', 42
      );
      expect(telegramService.sendPRNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'myorg',
          repo: 'my-repo',
          pr,
          threadId: 12345
        })
      );
      expect(eventBus.emitAsync).toHaveBeenCalledWith(
        'notification.sent',
        expect.objectContaining({
          instanceKey: 'github/myorg',
          repoName: 'my-repo',
          prNumber: 42
        })
      );
    });

    it('should use description as fallback when purpose is missing', async () => {
      const analysisNoPurpose = { riskLevel: 'low', impactArea: 'core', suspiciousPatterns: [] };

      await useCase.execute(instance, repo, pr, analysisNoPurpose);

      expect(telegramService.sendPRNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: expect.objectContaining({
            purpose: 'Fix bug'
          })
        })
      );
    });

    it('should use default message when no purpose or description', async () => {
      const analysisNoPurpose = { riskLevel: 'low', impactArea: 'core', suspiciousPatterns: [] };
      const prNoDesc = { number: 42 };

      await useCase.execute(instance, repo, prNoDesc, analysisNoPurpose);

      expect(telegramService.sendPRNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: expect.objectContaining({
            purpose: 'No description provided'
          })
        })
      );
    });

    it('should handle errors and emit failure event', async () => {
      telegramService.sendPRNotification.mockRejectedValue(new Error('Network error'));

      const result = await useCase.execute(instance, repo, pr, analysis);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');

      expect(eventBus.emitAsync).toHaveBeenCalledWith(
        'notification.failed',
        expect.objectContaining({
          instanceKey: 'github/myorg',
          repoName: 'my-repo',
          prNumber: 42,
          error: 'Network error'
        })
      );
    });
  });

  describe('sendOutdatedReviewNotification', () => {
    const instance = { key: 'github/myorg', owner: 'myorg' };
    const repo = { name: 'my-repo', threadId: 12345 };
    const review = {
      id: 'r1',
      state: 'CHANGES_REQUESTED',
      user: 'reviewer1',
      body: 'Please fix'
    };
    const pr = { number: 42 };

    it('should send outdated review notification on success', async () => {
      telegramService.sendOutdatedReviewNotification = jest.fn()
        .mockResolvedValue({ message_id: 99 });

      const result = await useCase.sendOutdatedReviewNotification(
        instance, repo, review, pr,
        { outdatedCommit: 'abc1234', currentCommit: 'def5678' }
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBe(99);

      expect(telegramService.sendOutdatedReviewNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'myorg',
          repo: 'my-repo',
          pr,
          reviewState: 'CHANGES_REQUESTED',
          reviewUser: 'reviewer1',
          outdatedCommit: 'abc1234',
          currentCommit: 'def5678',
          threadId: 12345
        })
      );

      expect(eventBus.emitAsync).toHaveBeenCalledWith(
        'review.outdated',
        expect.objectContaining({
          instanceKey: 'github/myorg',
          repoName: 'my-repo',
          reviewId: 'r1',
          prNumber: 42
        })
      );
    });

    it('should handle errors and emit failure event', async () => {
      telegramService.sendOutdatedReviewNotification = jest.fn()
        .mockRejectedValue(new Error('Send failed'));

      const result = await useCase.sendOutdatedReviewNotification(
        instance, repo, review, pr, {}
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Send failed');

      expect(eventBus.emitAsync).toHaveBeenCalledWith(
        'notification.failed',
        expect.objectContaining({
          reviewId: 'r1',
          error: 'Send failed'
        })
      );
    });
  });
});
