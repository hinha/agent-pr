/**
 * Unit tests for CheckOutdatedReviewsUseCase
 */

const CheckOutdatedReviewsUseCase = require('../../../../src/application/use-cases/CheckOutdatedReviewsUseCase');

describe('CheckOutdatedReviewsUseCase', () => {
  let useCase;
  let notificationService;
  let stateMachine;
  let eventBus;
  let logger;

  beforeEach(() => {
    notificationService = {
      sendOutdatedReviewNotification: jest.fn().mockResolvedValue({ success: true, message_id: 99 })
    };
    stateMachine = {
      getState: jest.fn().mockResolvedValue('notified'),
      isSkipped: jest.fn().mockResolvedValue(false),
      stateRepository: {
        getRepository: jest.fn().mockReturnValue({
          isOutdatedNotified: jest.fn().mockResolvedValue(false),
          markOutdatedNotified: jest.fn().mockResolvedValue(),
          clearOutdatedNotified: jest.fn().mockResolvedValue()
        })
      }
    };
    eventBus = {
      emitAsync: jest.fn().mockResolvedValue()
    };
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn()
    };
    useCase = new CheckOutdatedReviewsUseCase(notificationService, stateMachine, eventBus, { logger });
  });

  describe('execute', () => {
    const instance = { key: 'github/myorg', owner: 'myorg', maxAgeMs: 48 * 60 * 60 * 1000 };
    const repo = { name: 'my-repo', threadId: 12345 };
    const githubAdapter = { getPRReviews: jest.fn() };

    // Helper: create a fresh PR (within maxAgeHours)
    const freshPR = (overrides = {}) => ({
      number: 42, id: 'pr42', headSha: 'newsha123',
      createdAt: new Date().toISOString(),
      getAgeInMs: () => 1 * 60 * 60 * 1000, // 1 hour old
      ...overrides
    });

    it('should return empty result when no PRs', async () => {
      const result = await useCase.execute(instance, repo, [], githubAdapter);

      expect(result.outdatedReviews).toEqual([]);
      expect(result.notificationResults).toEqual([]);
    });

    it('should detect and notify for outdated reviews', async () => {
      const pr = freshPR();
      const review = {
        id: 'r1',
        state: 'CHANGES_REQUESTED',
        headSha: 'oldsha456',
        user: 'reviewer1',
        body: 'Fix this'
      };

      githubAdapter.getPRReviews = jest.fn().mockResolvedValue([review]);

      const result = await useCase.execute(instance, repo, [pr], githubAdapter);

      expect(result.outdatedReviews).toHaveLength(1);
      expect(result.notificationResults).toHaveLength(1);
      expect(result.notificationResults[0].prNumber).toBe(42);
      expect(result.notificationResults[0].sent).toBe(true);

      expect(notificationService.sendOutdatedReviewNotification).toHaveBeenCalledWith(
        instance, repo, review, pr,
        expect.objectContaining({
          outdatedCommit: 'oldsha456',
          currentCommit: 'newsha123'
        })
      );

      expect(eventBus.emitAsync).toHaveBeenCalledWith(
        'outdated_reviews.checked',
        expect.objectContaining({
          instanceKey: 'github/myorg',
          repoName: 'my-repo'
        })
      );
    });

    it('should skip PRs older than maxAgeMs', async () => {
      const oldPR = freshPR({ getAgeInMs: () => 72 * 60 * 60 * 1000 }); // 72 hours old (> 48h max)

      const result = await useCase.execute(instance, repo, [oldPR], githubAdapter);

      expect(result.outdatedReviews).toHaveLength(0);
      expect(result.notificationResults).toHaveLength(0);
      expect(githubAdapter.getPRReviews).not.toHaveBeenCalled();
    });

    it('should skip PRs older than maxAgeMs using createdAt fallback', async () => {
      const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
      const oldPR = { number: 99, id: 'pr99', headSha: 'sha', createdAt: threeDaysAgo };

      const result = await useCase.execute(instance, repo, [oldPR], githubAdapter);

      expect(result.outdatedReviews).toHaveLength(0);
      expect(githubAdapter.getPRReviews).not.toHaveBeenCalled();
    });

    it('should use default 48h max age when instance has no maxAgeMs', async () => {
      const instanceNoMax = { key: 'github/myorg', owner: 'myorg' };
      const oldPR = freshPR({ getAgeInMs: () => 72 * 60 * 60 * 1000 });

      const result = await useCase.execute(instanceNoMax, repo, [oldPR], githubAdapter);

      expect(result.outdatedReviews).toHaveLength(0);
      expect(githubAdapter.getPRReviews).not.toHaveBeenCalled();
    });

    it('should skip dismissed reviews', async () => {
      const pr = freshPR();
      const review = {
        id: 'r1', state: 'CHANGES_REQUESTED', headSha: 'oldsha456',
        user: 'reviewer1', body: 'Fix'
      };

      githubAdapter.getPRReviews = jest.fn().mockResolvedValue([review]);

      // Mark as dismissed
      const fsRepo = stateMachine.stateRepository.getRepository();
      fsRepo.isOutdatedNotified = jest.fn().mockResolvedValue(true);

      const result = await useCase.execute(instance, repo, [pr], githubAdapter);

      expect(result.notificationResults).toHaveLength(0);
      expect(notificationService.sendOutdatedReviewNotification).not.toHaveBeenCalled();
    });

    it('should skip outdated review notification for silenced PR', async () => {
      const pr = freshPR();
      const review = {
        id: 'r1', state: 'CHANGES_REQUESTED', headSha: 'oldsha456',
        user: 'reviewer1', body: 'Fix'
      };

      githubAdapter.getPRReviews = jest.fn().mockResolvedValue([review]);

      // Mark PR as silenced
      stateMachine.isSkipped = jest.fn().mockResolvedValue(true);

      const result = await useCase.execute(instance, repo, [pr], githubAdapter);

      expect(result.notificationResults).toHaveLength(0);
      expect(notificationService.sendOutdatedReviewNotification).not.toHaveBeenCalled();
      expect(stateMachine.isSkipped).toHaveBeenCalledWith('github/myorg', 'my-repo', 42);
    });

    it('should skip outdated review notification for PR in APPROVED state with skip metadata', async () => {
      const pr = freshPR();
      const review = {
        id: 'r1', state: 'APPROVED', headSha: 'oldsha456',
        user: 'reviewer1', body: 'LGTM'
      };

      githubAdapter.getPRReviews = jest.fn().mockResolvedValue([review]);

      // PR is in APPROVED state but has active skip metadata
      stateMachine.getState = jest.fn().mockResolvedValue('approved');
      stateMachine.isSkipped = jest.fn().mockResolvedValue(true);

      const result = await useCase.execute(instance, repo, [pr], githubAdapter);

      expect(result.notificationResults).toHaveLength(0);
      expect(notificationService.sendOutdatedReviewNotification).not.toHaveBeenCalled();
    });

    it('should skip dismissed reviews (state=DISMISSED)', async () => {
      const pr = freshPR();
      const review = {
        id: 'r1', state: 'DISMISSED', headSha: 'oldsha456',
        user: 'reviewer1', body: ''
      };

      githubAdapter.getPRReviews = jest.fn().mockResolvedValue([review]);

      const result = await useCase.execute(instance, repo, [pr], githubAdapter);

      expect(result.outdatedReviews).toHaveLength(0);
    });

    it('should handle errors and emit error event', async () => {
      githubAdapter.getPRReviews = jest.fn().mockRejectedValue(new Error('API error'));

      await expect(
        useCase.execute(instance, repo, [freshPR({ number: 1, id: '1' })], githubAdapter)
      ).rejects.toThrow('API error');

      expect(eventBus.emitAsync).toHaveBeenCalledWith(
        'error.occurred',
        expect.objectContaining({
          useCase: 'CheckOutdatedReviewsUseCase',
          error: 'API error'
        })
      );
    });
  });

  describe('_isReviewOutdated', () => {
    const instance = { key: 'github/myorg' };
    const repo = { name: 'my-repo' };

    it('should return false for dismissed review', async () => {
      const result = await useCase._isReviewOutdated(
        instance, repo,
        { headSha: 'new' },
        { state: 'DISMISSED', headSha: 'old' }
      );
      expect(result).toBe(false);
    });

    it('should return false when headSha matches', async () => {
      const result = await useCase._isReviewOutdated(
        instance, repo,
        { headSha: 'same123', number: 1 },
        { state: 'APPROVED', headSha: 'same123' }
      );
      expect(result).toBe(false);
    });

    it('should return false for processed PR state', async () => {
      stateMachine.getState = jest.fn().mockResolvedValue('processed');

      const result = await useCase._isReviewOutdated(
        instance, repo,
        { headSha: 'new', number: 1 },
        { state: 'APPROVED', headSha: 'old' }
      );
      expect(result).toBe(false);
    });

    it('should return false for closed PR state', async () => {
      stateMachine.getState = jest.fn().mockResolvedValue('closed');

      const result = await useCase._isReviewOutdated(
        instance, repo,
        { headSha: 'new', number: 1 },
        { state: 'APPROVED', headSha: 'old' }
      );
      expect(result).toBe(false);
    });

    it('should return false for approved PR state', async () => {
      stateMachine.getState = jest.fn().mockResolvedValue('approved');

      const result = await useCase._isReviewOutdated(
        instance, repo,
        { headSha: 'new', number: 1 },
        { state: 'APPROVED', headSha: 'old' }
      );
      expect(result).toBe(false);
    });

    it('should return false for rejected PR state', async () => {
      stateMachine.getState = jest.fn().mockResolvedValue('rejected');

      const result = await useCase._isReviewOutdated(
        instance, repo,
        { headSha: 'new', number: 1 },
        { state: 'APPROVED', headSha: 'old' }
      );
      expect(result).toBe(false);
    });

    it('should return true when SHA differs and PR is active', async () => {
      stateMachine.getState = jest.fn().mockResolvedValue('notified');

      const result = await useCase._isReviewOutdated(
        instance, repo,
        { headSha: 'new', number: 1 },
        { state: 'APPROVED', headSha: 'old' }
      );
      expect(result).toBe(true);
    });
  });

  describe('dismissOutdatedReview', () => {
    const instance = { owner: 'myorg' };
    const repo = { name: 'my-repo' };

    it('should mark as dismissed with prId and headSha', async () => {
      const result = await useCase.dismissOutdatedReview(
        instance, repo, 'r1', '42', 'abc1234'
      );

      expect(result.success).toBe(true);
      const fsRepo = stateMachine.stateRepository.getRepository();
      expect(fsRepo.markOutdatedNotified).toHaveBeenCalledWith('myorg', 'my-repo', '42', 'abc1234');
    });

    it('should clear outdated data with prId but no headSha', async () => {
      const result = await useCase.dismissOutdatedReview(
        instance, repo, 'r1', '42', null
      );

      expect(result.success).toBe(true);
      const fsRepo = stateMachine.stateRepository.getRepository();
      expect(fsRepo.clearOutdatedNotified).toHaveBeenCalledWith('myorg', 'my-repo', '42');
    });

    it('should return success when no prId or stateRepository', async () => {
      const noStateUseCase = new CheckOutdatedReviewsUseCase(
        notificationService, { stateRepository: null }, eventBus, { logger }
      );

      const result = await noStateUseCase.dismissOutdatedReview(
        instance, repo, 'r1'
      );

      expect(result.success).toBe(true);
    });

    it('should handle errors gracefully', async () => {
      const fsRepo = stateMachine.stateRepository.getRepository();
      fsRepo.markOutdatedNotified = jest.fn().mockRejectedValue(new Error('DB error'));

      const result = await useCase.dismissOutdatedReview(
        instance, repo, 'r1', '42', 'abc'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('DB error');
    });
  });
});
